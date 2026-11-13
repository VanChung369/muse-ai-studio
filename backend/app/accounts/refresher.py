"""Re-check verified sessions in the background so they do not lapse unnoticed."""

import logging
import threading
from datetime import UTC, datetime, timedelta

from app.accounts.operations import (
    AccountChangedError,
    AccountNotFoundError,
    run_account_operation,
)
from app.core.account_operations import AccountBusyError
from app.repositories import accounts

logger = logging.getLogger(__name__)

# A session about to expire is re-checked at most this often.
RETRY_GAP = timedelta(minutes=30)


class SessionRefresher:
    """Runs the account check for enabled, verified accounts on a schedule.

    Muse may rotate cookies on any successful response; the check stores them,
    which is what moves an account's expiry forward. A session Muse rejects is
    marked invalid and left alone: only new cookies can restore it. Unverified
    accounts are never contacted, so importing one stays free of upstream calls.
    """

    def __init__(
        self,
        app,
        interval: timedelta,
        wake: bool = False,
        poll_interval: float = 60.0,
    ):
        self.app = app
        self.interval = interval
        self.retry_gap = min(interval, RETRY_GAP)
        self.action = "keep-alive" if wake else "test"
        self.poll_interval = poll_interval
        self._stopping = threading.Event()
        self._thread: threading.Thread | None = None
        # Last attempt per account. A check that could not be saved leaves
        # last_checked_at untouched; this still spaces out the upstream calls.
        self._attempts: dict[str, datetime] = {}

    def start(self) -> None:
        if self.interval <= timedelta(0):
            return  # Disabled by configuration.
        self._stopping.clear()
        self._thread = threading.Thread(
            target=self._loop, name="session-refresher", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop scheduling checks. The thread is a daemon, so shutdown never
        waits for an upstream call that is still in flight."""
        self._stopping.set()
        if self._thread:
            self._thread.join(timeout=2)

    def _loop(self) -> None:
        while not self._stopping.wait(self.poll_interval):
            try:
                self.run_once()
            except Exception:  # noqa: BLE001 - keep refreshing after a DB hiccup
                logger.exception("Session refresher error")

    def run_once(self, now: datetime | None = None) -> int:
        """Check every due account once. Returns how many checks ran."""
        state = self.app.state
        # Stored as naive UTC, like the other tables.
        now = now or datetime.now(UTC).replace(tzinfo=None)
        with state.database.sessions() as session:
            due = accounts.sessions_due(session, now, self.interval, self.retry_gap)
        self._attempts = {
            account_id: attempted
            for account_id, attempted in self._attempts.items()
            if attempted > now - self.retry_gap
        }
        checked = 0
        for account_id in due:
            if self._stopping.is_set():
                break
            if account_id in self._attempts:
                continue
            self._attempts[account_id] = now
            try:
                with state.database.sessions() as session:
                    outcome = run_account_operation(
                        session,
                        state.account_vault,
                        state.account_operations,
                        state.muse_client,
                        account_id,
                        self.action,
                    )
            except AccountBusyError:
                # A task or a manual check holds the account: try next round.
                del self._attempts[account_id]
                continue
            except (AccountNotFoundError, AccountChangedError):
                continue
            except Exception:  # noqa: BLE001 - one account must not stop the rest
                logger.exception("Session refresh failed for account %s", account_id)
                continue
            checked += 1
            if outcome.failure:
                logger.warning(
                    "Session refresh for account %s: %s",
                    account_id,
                    outcome.failure.code,
                )
        return checked
