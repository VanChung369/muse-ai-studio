import json
from datetime import UTC, datetime, timedelta

from cryptography.fernet import InvalidToken
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.account_vault import AccountVault
from app.core.account_cookies import account_expiry
from app.integrations.muse.proxy import public_proxy
from app.models.account import Account
from app.models.task import Task
from app.schemas.account import AccountPatch, AccountResponse, AccountQuota, ProxyPublic


class DuplicateAccountError(ValueError):
    pass


def list_accounts(session: Session) -> list[Account]:
    # Creation order, not updated_at: enabling, renaming, or checking an
    # account must not move its row under the user's pointer.
    return list(
        session.scalars(select(Account).order_by(Account.created_at.desc(), Account.id))
    )


def get_account(session: Session, account_id: str) -> Account | None:
    return session.get(Account, account_id)


def sessions_due(
    session: Session,
    now: datetime,
    interval: timedelta,
    retry_gap: timedelta,
    account_id: str | None = None,
) -> list[str]:
    """IDs of enabled, verified accounts whose session should be re-checked.

    Due when the last check is older than `interval`, or sooner (every
    `retry_gap`) while the session would expire before the next regular check.
    `now` is naive UTC, like the stored timestamps. `account_id` limits the
    answer to that one account.
    """
    return list(
        session.scalars(
            select(Account.id)
            .where(
                *([Account.id == account_id] if account_id else []),
                Account.enabled.is_(True),
                Account.session_status == "valid",
                or_(
                    Account.last_checked_at.is_(None),
                    Account.last_checked_at <= now - interval,
                    and_(
                        Account.expires_at > now,
                        Account.expires_at <= now + interval,
                        Account.last_checked_at <= now - retry_gap,
                    ),
                ),
            )
            .order_by(Account.last_checked_at, Account.id)
        )
    )


def import_account(
    session: Session,
    vault: AccountVault,
    label: str,
    cookies: dict[str, str],
    expiries: dict[str, int] | None = None,
) -> Account:
    account = Account(
        label=label,
        encrypted_cookies=vault.encrypt(cookies),
        session_fingerprint=vault.fingerprint(cookies["hatch_sess"]),
        cookie_count=len(cookies),
        cookie_expiries=json.dumps(expiries or {}),
        expires_at=account_expiry(expiries or {}),
    )
    session.add(account)
    try:
        session.commit()
        session.refresh(account)
    except IntegrityError:
        fingerprint = account.session_fingerprint
        session.rollback()
        if (
            session.scalar(
                select(Account.id).where(Account.session_fingerprint == fingerprint)
            )
            is not None
        ):
            raise DuplicateAccountError from None
        raise
    except Exception:
        session.rollback()
        raise
    return account


def patch_account(
    session: Session, account_id: str, values: AccountPatch
) -> Account | None:
    try:
        result = session.execute(
            update(Account)
            .where(Account.id == account_id)
            .values(**values.model_dump(exclude_unset=True))
            .execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            session.rollback()
            return None
        session.commit()
        session.expire_all()
        return get_account(session, account_id)
    except Exception:
        session.rollback()
        raise


def delete_account(session: Session, account_id: str) -> bool:
    try:
        # Queued tasks pinned to this account would otherwise lose it (FK SET
        # NULL) and silently run on another one. Fail them so the user decides
        # ("retry with another account"). Running tasks hold the account lock,
        # so deletion is refused while one runs.
        now = datetime.now(UTC).replace(tzinfo=None)
        session.execute(
            update(Task)
            .where(Task.account_id == account_id, Task.status == "queued")
            .values(
                status="failed",
                finished_at=now,
                updated_at=now,
                retryable=True,
                error_code="account_deleted",
                suggested_action="switch_account",
                error_message="The account for this task was deleted.",
            )
        )
        result = session.execute(delete(Account).where(Account.id == account_id))
        session.commit()
        return result.rowcount == 1
    except Exception:
        session.rollback()
        raise


def running_task_counts(
    session: Session, account_id: str | None = None
) -> dict[str, int]:
    """Running tasks per account ID; accounts without any are absent."""
    statement = (
        select(Task.account_id, func.count())
        .where(Task.status == "running", Task.account_id.is_not(None))
        .group_by(Task.account_id)
    )
    if account_id is not None:
        statement = statement.where(Task.account_id == account_id)
    return dict(session.execute(statement).all())


def public_account(
    session: Session,
    account: Account,
    vault: AccountVault,
    running: dict[str, int] | None = None,
) -> AccountResponse:
    """Build the public view. `running` avoids one count query per account
    when the caller already loaded the counts for a whole list."""
    response = AccountResponse.model_validate(account)
    if running is None:
        running = running_task_counts(session, account.id)
    response.running_tasks = running.get(account.id, 0)
    if account.encrypted_proxy:
        response.proxy = ProxyPublic.model_validate(
            public_proxy(vault.decrypt(account.encrypted_proxy))
        )
    if account.quota_json:
        response.quota = AccountQuota.model_validate_json(account.quota_json)
    return response


def refresh_fingerprints(session: Session, vault: AccountVault) -> int:
    """Recompute session fingerprints with the vault's current derivation.

    Fingerprints stored before the dedicated HMAC subkey existed no longer
    match, which would let a duplicate session be imported. Idempotent.
    """
    changed = 0
    try:
        for account in session.scalars(select(Account)):
            try:
                cookies = vault.decrypt(account.encrypted_cookies)
            except InvalidToken:
                raise RuntimeError(
                    f"Account {account.id} cannot be decrypted with account-secret.key. "
                    "Restore the matching key from the database backup."
                ) from None
            fingerprint = vault.fingerprint(cookies["hatch_sess"])
            if account.session_fingerprint != fingerprint:
                account.session_fingerprint = fingerprint
                changed += 1
        session.commit()
    except Exception:
        session.rollback()
        raise
    return changed


def replace_credentials(session, vault, account_id, cookies, expiries):
    values = {
        "encrypted_cookies": vault.encrypt(cookies),
        "session_fingerprint": vault.fingerprint(cookies["hatch_sess"]),
        "cookie_count": len(cookies),
        "cookie_expiries": json.dumps(expiries),
        "expires_at": account_expiry(expiries),
        "credential_version": Account.credential_version + 1,
        "session_status": "unverified",
        "last_checked_at": None,
        "last_keepalive_at": None,
        "last_error": None,
        "quota_json": None,
        "quota_checked_at": None,
    }
    return update_values(session, account_id, values)


def update_values(session, account_id, values, version=None):
    try:
        statement = update(Account).where(Account.id == account_id)
        if version is not None:
            statement = statement.where(Account.credential_version == version)
        result = session.execute(
            statement.values(**values).execution_options(synchronize_session=False)
        )
        if result.rowcount != 1:
            session.rollback()
            return None
        session.commit()
        session.expire_all()
        return get_account(session, account_id)
    except IntegrityError as error:
        session.rollback()
        if "session_fingerprint" in str(error.orig):
            raise DuplicateAccountError from None
        raise  # e.g. a CHECK constraint: a real bug, not a duplicate session.
    except Exception:
        session.rollback()
        raise
