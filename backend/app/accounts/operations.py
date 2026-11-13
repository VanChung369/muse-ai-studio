"""Remote account checks, shared by the API routes and the session refresher."""

import json
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.account_cookies import account_expiry, limit_cookies
from app.core.account_operations import AccountOperations
from app.core.account_vault import AccountVault
from app.integrations.muse.client import MuseError, SessionResult
from app.models.account import Account
from app.repositories import accounts


class AccountNotFoundError(Exception):
    pass


class AccountChangedError(Exception):
    """The credentials changed while the remote call was in flight."""


@dataclass
class OperationOutcome:
    account: Account
    # None only when the call failed before Muse returned any cookies.
    result: SessionResult | None
    failure: MuseError | None


def run_account_operation(
    session: Session,
    vault: AccountVault,
    operations: AccountOperations,
    client,
    account_id: str,
    action: str,
) -> OperationOutcome:
    """Run `test`, `keep-alive` or `quota` and store what Muse returned.

    Raises AccountBusyError when another operation holds the account.
    """
    with operations.acquire(account_id):
        account = accounts.get_account(session, account_id)
        if account is None:
            raise AccountNotFoundError
        version = account.credential_version
        cookies = vault.decrypt(account.encrypted_cookies)
        expiries = json.loads(account.cookie_expiries)
        proxy = (
            vault.decrypt(account.encrypted_proxy) if account.encrypted_proxy else None
        )
        session.rollback()  # Never hold a SQLite transaction across upstream I/O.
        failure = None
        try:
            result = (
                client.quota(cookies, expiries, proxy)
                if action == "quota"
                else client.session(
                    cookies, expiries, proxy, wake=action == "keep-alive"
                )
            )
        except MuseError as error:
            result, failure = error.partial, error
        now = datetime.now(UTC)
        updates = {
            "last_checked_at": now,
            "last_error": (
                failure.code if failure else (None if result.ok else result.code)
            ),
        }
        if action == "keep-alive" and failure is None and result.ok:
            # Only a keep-alive that reached the workspace counts as one.
            updates["last_keepalive_at"] = now
        # A partial result whose hatch_sess expired (e.g. during keep-alive)
        # cannot be stored: keep the previous credentials, record the failure.
        if result is not None and result.cookies.get("hatch_sess"):
            # Muse can grow the jar past the stored limit; keep the session.
            stored_cookies, stored_expiries = limit_cookies(
                result.cookies, result.expiries
            )
            updates.update(
                encrypted_cookies=vault.encrypt(stored_cookies),
                session_fingerprint=vault.fingerprint(stored_cookies["hatch_sess"]),
                cookie_count=len(stored_cookies),
                cookie_expiries=json.dumps(stored_expiries),
                expires_at=account_expiry(stored_expiries),
                credential_version=version + 1,
            )
            if result.verified:
                # Rotated cookies from a failed check are kept, but only a
                # confirmed session marks the account valid.
                updates["session_status"] = "valid"
            if result.quota is not None:
                updates.update(
                    quota_json=json.dumps(result.quota), quota_checked_at=now
                )
        if failure and failure.code == "session_invalid":
            updates["session_status"] = "invalid"
        account = accounts.update_values(session, account_id, updates, version)
        if account is None:
            raise AccountChangedError
        return OperationOutcome(account, result, failure)
