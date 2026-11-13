from contextlib import contextmanager
from threading import Lock


class AccountBusyError(Exception):
    pass


class AccountOperations:
    def __init__(self):
        self._guard = Lock()
        self._locks: dict[str, Lock] = {}

    @contextmanager
    def acquire(self, account_id: str):
        with self._guard:
            lock = self._locks.setdefault(account_id, Lock())
        if not lock.acquire(blocking=False):
            raise AccountBusyError
        try:
            yield
        finally:
            lock.release()
