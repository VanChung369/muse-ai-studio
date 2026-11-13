from contextlib import contextmanager
from threading import Lock


class AccountBusyError(Exception):
    pass


class AccountOperations:
    """At most one remote or credential operation per account at a time.

    Tracks busy IDs rather than keeping a Lock per account, so nothing is
    retained after an operation ends (including for deleted or unknown IDs).
    """

    def __init__(self):
        self._guard = Lock()
        self._busy: set[str] = set()

    @contextmanager
    def acquire(self, account_id: str):
        with self._guard:
            if account_id in self._busy:
                raise AccountBusyError
            self._busy.add(account_id)
        try:
            yield
        finally:
            with self._guard:
                self._busy.discard(account_id)
