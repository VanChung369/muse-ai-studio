from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.accounts.operations import (
    AccountChangedError,
    AccountNotFoundError,
    run_account_operation,
)
from app.core.account_cookies import CookieImportError, parse_cookie_bundle
from app.core.account_operations import AccountBusyError
from app.models.account import Account
from app.repositories import accounts
from app.schemas.account import (
    AccountImport,
    AccountListResponse,
    AccountPatch,
    AccountResponse,
    AccountActionResponse,
    CookieUpdate,
    ProxyUpdate,
)


class AccountRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request: Request):
            try:
                try:
                    response = await original(request)
                except AccountBusyError:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "account_busy",
                            "message": "An account operation is already running.",
                        },
                    ) from None
                except accounts.DuplicateAccountError:
                    raise HTTPException(
                        status_code=409,
                        detail={
                            "code": "account_exists",
                            "message": "This session has already been imported.",
                        },
                    ) from None
            except HTTPException as error:
                # Render errors here (instead of letting them propagate) so
                # they also get no-store: they answer credential requests too.
                response = JSONResponse(
                    status_code=error.status_code,
                    content={"detail": error.detail},
                    headers=error.headers,
                )
            except RequestValidationError as error:
                # FastAPI's default validation response echoes invalid input.
                # Account imports must never return pasted credentials.
                response = JSONResponse(
                    status_code=422,
                    content={
                        "detail": [
                            {
                                "loc": item["loc"],
                                "msg": item["msg"],
                                "type": item["type"],
                            }
                            for item in error.errors()
                        ],
                    },
                )
            response.headers["Cache-Control"] = "no-store"
            return response

        return handler


router = APIRouter(prefix="/accounts", tags=["Accounts"], route_class=AccountRoute)
DatabaseSession = Annotated[Session, Depends(get_session)]


def account_changed() -> HTTPException:
    return HTTPException(
        status_code=409,
        detail={
            "code": "account_changed",
            "message": "Account credentials changed. Reload and retry.",
        },
    )


def not_found() -> HTTPException:
    return HTTPException(
        status_code=404,
        detail={"code": "account_not_found", "message": "Account not found."},
    )


@router.get("", response_model=AccountListResponse)
def list_accounts(request: Request, session: DatabaseSession) -> AccountListResponse:
    items = [
        accounts.public_account(account, request.app.state.account_vault)
        for account in accounts.list_accounts(session)
    ]
    return AccountListResponse(items=items, total=len(items))


@router.post(
    "",
    response_model=AccountResponse,
    status_code=status.HTTP_201_CREATED,
    responses={409: {"description": "Session already imported"}},
)
def import_account(
    values: AccountImport,
    request: Request,
    response: Response,
    session: DatabaseSession,
) -> AccountResponse:
    try:
        cookies, expiries = parse_cookie_bundle(values.cookie_text.get_secret_value())
    except CookieImportError as error:
        raise HTTPException(
            status_code=422, detail={"code": error.code, "message": str(error)}
        ) from None
    # DuplicateAccountError becomes the 409 in AccountRoute.
    account = accounts.import_account(
        session, request.app.state.account_vault, values.label, cookies, expiries
    )
    response.headers["Location"] = str(
        request.url_for("get_account", account_id=account.id)
    )
    return accounts.public_account(account, request.app.state.account_vault)


@router.get(
    "/{account_id}",
    response_model=AccountResponse,
    responses={404: {"description": "Account not found"}},
)
def get_account(
    account_id: str, request: Request, session: DatabaseSession
) -> AccountResponse:
    account = accounts.get_account(session, account_id)
    if account is None:
        raise not_found()
    return accounts.public_account(account, request.app.state.account_vault)


@router.patch(
    "/{account_id}",
    response_model=AccountResponse,
    responses={404: {"description": "Account not found"}},
)
def patch_account(
    account_id: str, values: AccountPatch, request: Request, session: DatabaseSession
) -> AccountResponse:
    account = accounts.patch_account(session, account_id, values)
    if account is None:
        raise not_found()
    return accounts.public_account(account, request.app.state.account_vault)


@router.delete(
    "/{account_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={404: {"description": "Account not found"}},
)
def delete_account(
    account_id: str, request: Request, session: DatabaseSession
) -> Response:
    with request.app.state.account_operations.acquire(account_id):
        if not accounts.delete_account(session, account_id):
            raise not_found()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/{account_id}/cookies", response_model=AccountResponse)
def update_cookies(
    account_id: str, values: CookieUpdate, request: Request, session: DatabaseSession
):
    try:
        cookies, expiries = parse_cookie_bundle(values.cookie_text.get_secret_value())
    except CookieImportError as error:
        raise HTTPException(
            422, detail={"code": error.code, "message": str(error)}
        ) from None
    with request.app.state.account_operations.acquire(account_id):
        account = accounts.replace_credentials(
            session, request.app.state.account_vault, account_id, cookies, expiries
        )
        if account is None:
            raise not_found()
        return accounts.public_account(account, request.app.state.account_vault)


@router.put("/{account_id}/proxy", response_model=AccountResponse)
def update_proxy(
    account_id: str, values: ProxyUpdate, request: Request, session: DatabaseSession
):
    vault = request.app.state.account_vault
    with request.app.state.account_operations.acquire(account_id):
        account = accounts.get_account(session, account_id)
        if account is None:
            raise not_found()
        version = account.credential_version
        previous = (
            vault.decrypt(account.encrypted_proxy) if account.encrypted_proxy else {}
        )
        proxy = None
        if values.proxy is not None:
            proxy = {"server": values.proxy.server, "username": values.proxy.username}
            if values.proxy.password is None:
                if (
                    previous.get("server") == proxy["server"]
                    and previous.get("username") == proxy["username"]
                ):
                    proxy["password"] = previous.get("password", "")
                elif proxy["username"]:
                    raise HTTPException(
                        422,
                        detail={
                            "code": "proxy_password_required",
                            "message": "Enter the password when changing the proxy account.",
                        },
                    )
                else:
                    proxy["password"] = ""
            else:
                proxy["password"] = values.proxy.password.get_secret_value()
        session.rollback()
        account = accounts.update_values(
            session,
            account_id,
            {
                "encrypted_proxy": vault.encrypt(proxy) if proxy else None,
                "credential_version": version + 1,
                "session_status": "unverified",
                "last_checked_at": None,
                "last_error": None,
                "quota_json": None,
                "quota_checked_at": None,
            },
            version,
        )
        if account is None:
            raise account_changed()
        return accounts.public_account(account, vault)


def run_operation(
    account_id: str, action: str, request: Request, session: DatabaseSession
):
    state = request.app.state
    try:
        outcome = run_account_operation(
            session,
            state.account_vault,
            state.account_operations,
            state.muse_client,
            account_id,
            action,
        )
    except AccountNotFoundError:
        raise not_found() from None
    except AccountChangedError:
        raise account_changed() from None
    public = accounts.public_account(outcome.account, state.account_vault)
    result, failure = outcome.result, outcome.failure
    if failure:
        if failure.code == "session_invalid":
            return AccountActionResponse(
                account=public, ok=False, code="session_invalid"
            )
        raise HTTPException(
            failure.status,
            detail={
                "code": failure.code,
                "message": failure.detail
                or "The account operation could not be completed.",
            },
        ) from None
    return AccountActionResponse(
        account=public, ok=result.ok, code=result.code, vm_state=result.vm_state
    )


@router.post("/{account_id}/test", response_model=AccountActionResponse)
def test_account(account_id: str, request: Request, session: DatabaseSession):
    return run_operation(account_id, "test", request, session)


@router.post("/{account_id}/keep-alive", response_model=AccountActionResponse)
def keep_account_alive(account_id: str, request: Request, session: DatabaseSession):
    return run_operation(account_id, "keep-alive", request, session)


@router.post("/{account_id}/quota", response_model=AccountActionResponse)
def refresh_account_quota(account_id: str, request: Request, session: DatabaseSession):
    return run_operation(account_id, "quota", request, session)
