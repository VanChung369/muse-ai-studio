import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from tempfile import NamedTemporaryFile

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

# Separate key roles: Fernet encrypts secrets; this HKDF subkey only keys the
# session fingerprint HMAC used for duplicate detection.
# urlsafe base64 of 32 bytes.
FERNET_KEY_LENGTH = 44
FINGERPRINT_KEY_INFO = b"muse-ai-studio/session-fingerprint/v1"


class AccountVault:
    def __init__(self, key_path: Path):
        self.key_path = key_path
        self._fernet: Fernet | None = None
        self._fingerprint_key: bytes | None = None

    def prepare(self, existing_ciphertext: str | None = None) -> None:
        if not self.key_path.exists():
            if existing_ciphertext is not None:
                raise RuntimeError(
                    "Account encryption key is missing. Restore account-secret.key from the database backup."
                )
            self.key_path.parent.mkdir(parents=True, exist_ok=True)
            # Publish a fully written key atomically, without replacing one
            # another process may already have created.
            with NamedTemporaryFile(
                dir=self.key_path.parent, prefix=".account-key-", delete=False
            ) as file:
                temporary = Path(file.name)
                os.chmod(temporary, 0o600)
                file.write(Fernet.generate_key())
                file.flush()
                os.fsync(file.fileno())
            try:
                try:
                    os.link(temporary, self.key_path)
                except FileExistsError:
                    pass
                except OSError:
                    # Hard links are unsupported on FAT/exFAT, SMB, and some
                    # container mounts. Exclusive create still never replaces
                    # a key another process already published.
                    self._create_exclusive(temporary.read_bytes())
            finally:
                temporary.unlink(missing_ok=True)
        try:
            key = self._read_key()
            self._fernet = Fernet(key)
            self._fingerprint_key = HKDF(
                algorithm=hashes.SHA256(),
                length=32,
                salt=None,
                info=FINGERPRINT_KEY_INFO,
            ).derive(key)
            if existing_ciphertext is not None:
                self._fernet.decrypt(existing_ciphertext.encode())
        except (ValueError, InvalidToken):
            raise RuntimeError(
                "Account encryption key is invalid or does not match the stored accounts."
            ) from None

    def _read_key(self) -> bytes:
        # The exclusive-create fallback publishes the file before writing it.
        # Another process starting at the same moment can see it empty or
        # partial; wait briefly for the complete key instead of failing.
        deadline = time.monotonic() + 2
        while True:
            key = self.key_path.read_bytes().strip()
            if len(key) >= FERNET_KEY_LENGTH or time.monotonic() >= deadline:
                return key
            time.sleep(0.05)

    def _create_exclusive(self, key: bytes) -> None:
        try:
            descriptor = os.open(
                self.key_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600
            )
        except FileExistsError:
            return
        with os.fdopen(descriptor, "wb") as file:
            file.write(key)
            file.flush()
            os.fsync(file.fileno())

    def encrypt(self, cookies: dict[str, str]) -> str:
        if self._fernet is None:
            raise RuntimeError("Account vault is not initialized.")
        return self._fernet.encrypt(
            json.dumps(cookies, separators=(",", ":")).encode()
        ).decode()

    def decrypt(self, ciphertext: str) -> dict[str, str]:
        if self._fernet is None:
            raise RuntimeError("Account vault is not initialized.")
        return json.loads(self._fernet.decrypt(ciphertext.encode()))

    def fingerprint(self, session_cookie: str) -> str:
        if self._fingerprint_key is None:
            raise RuntimeError("Account vault is not initialized.")
        return hmac.new(
            self._fingerprint_key,
            b"muse-session:" + session_cookie.encode(),
            hashlib.sha256,
        ).hexdigest()
