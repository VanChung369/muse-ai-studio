"""An account's credentials for the duration of one generation task."""

import json
from datetime import UTC, datetime

from app.core.account_cookies import account_expiry, limit_cookies
from app.integrations.muse.client import MuseError
from app.models import Account
from app.repositories import accounts
from app.tasks.coordinator import TaskDeferred, TaskFailure


class TaskAccountSession:
    """Loads the task's account, saves cookies Muse rotates while the task
    runs, and turns upstream errors into task outcomes.

    Shared by every handler that drives the Muse composer (script planning,
    scene rendering), so credential handling stays in one place.
    """

    def __init__(self, app, account_id: str):
        self.database, self.vault = app.state.database, app.state.account_vault
        self.account_id = account_id
        with self.database.sessions() as session:
            account = session.get(Account, account_id)
            if (
                account is None
                or not account.enabled
                or account.session_status != "valid"
            ):
                raise TaskFailure("account_unavailable", suggested_action="relogin")
            self.version = account.credential_version
            self.cookies = self.vault.decrypt(account.encrypted_cookies)
            self.expiries = json.loads(account.cookie_expiries)
            self.proxy = (
                self.vault.decrypt(account.encrypted_proxy)
                if account.encrypted_proxy
                else None
            )
        self._persisted = []  # SessionResults already saved.

    def persist(self, result) -> None:
        """Save a session result's cookies (the generators' `on_session`)."""
        now = datetime.now(UTC)
        # Muse can grow the jar past the stored limit (CHECK 1..100).
        cookies, cookie_expiries = limit_cookies(result.cookies, result.expiries)
        values = {
            "encrypted_cookies": self.vault.encrypt(cookies),
            "session_fingerprint": self.vault.fingerprint(cookies["hatch_sess"]),
            "cookie_expiries": json.dumps(cookie_expiries),
            "cookie_count": len(cookies),
            "expires_at": account_expiry(cookie_expiries),
            "last_checked_at": now,
            "credential_version": self.version + 1,
        }
        if result.verified:
            values.update(session_status="valid", last_error=None)
        with self.database.sessions() as session:
            updated = accounts.update_values(
                session, self.account_id, values, self.version
            )
            if updated is None:
                raise TaskFailure("account_changed")
        self.version += 1
        self._persisted.append(result)

    def failure(self, error: MuseError) -> Exception:
        """The exception a handler should raise for an upstream error."""
        saved = any(error.partial is result for result in self._persisted)
        if error.code == "browser_busy" and saved:
            # Nothing was sent yet (the browser slot was taken before the
            # composer opened): wait for a slot instead of failing.
            return TaskDeferred("browser_busy", delay=15)
        partial = error.partial
        if partial and partial.cookies.get("hatch_sess") and not saved:
            # Only save cookies `persist` did not already store, so a late
            # failure does not bump credential_version again.
            self.persist(partial)
        if error.code == "session_invalid":
            with self.database.sessions() as session:
                accounts.update_values(
                    session,
                    self.account_id,
                    {"session_status": "invalid", "last_error": error.code},
                    self.version,
                )
        hint = {
            "session_invalid": "relogin",
            "proxy_error": "check_proxy",
            "quota_exhausted": "switch_account",
        }.get(error.code, "retry")
        return TaskFailure(error.code, error.detail, suggested_action=hint)
