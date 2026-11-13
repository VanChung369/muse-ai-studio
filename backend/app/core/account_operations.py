from contextlib import contextmanager
from threading import Lock


class AccountBusyError(Exception):
    pass


class AccountOperations:
    """At most one remote or credential operation per account at a time.

    Shared by request handlers (test, keep-alive, cookie or proxy changes,
    delete) and the task coordinator, so a generation task never runs while
    the same account is being checked or edited. Tracks busy IDs rather than
    keeping a Lock per account, so nothing is retained afterwards.
    """

    def __init__(self):
        self._guard = Lock()
        self._busy: set[str] = set()

    def try_acquire(self, account_id: str) -> bool:
        with self._guard:
            if account_id in self._busy:
                return False
            self._busy.add(account_id)
            return True

    def release(self, account_id: str) -> None:
        with self._guard:
            self._busy.discard(account_id)

    def is_busy(self, account_id: str) -> bool:
        with self._guard:
            return account_id in self._busy

    @contextmanager
    def acquire(self, account_id: str):
        if not self.try_acquire(account_id):
            raise AccountBusyError
        try:
            yield
        finally:
            self.release(account_id)
