"""MuseClient failure paths: rotated cookies survive, errors stay typed."""

import pytest
import requests
from fastapi.testclient import TestClient
from playwright.sync_api import Error as BrowserError

from app.core.account_operations import AccountBusyError, AccountOperations
from app.core.config import Settings
from app.integrations.muse.client import MuseClient, MuseError, SessionResult
from app.main import create_app


class FakeResponse:
    def __init__(self, body, cookies=None):
        self._body = body
        self.cookies = requests.cookies.RequestsCookieJar()
        for name, value in (cookies or {}).items():
            self.cookies.set(name, value, domain="muse.ai", path="/")

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


@pytest.fixture
def muse(tmp_path):
    return MuseClient(Settings(_env_file=None, data_dir=tmp_path))


@pytest.mark.parametrize(
    "body,code",
    [
        ({"status": "pending"}, "workspace_unavailable"),
        (ValueError("not json"), "invalid_response"),
    ],
)
def test_session_failures_keep_rotated_cookies(muse, monkeypatch, body, code):
    response = FakeResponse(body, {"hatch_sess": "rotated"})
    monkeypatch.setattr(muse, "_request", lambda *args, **kwargs: response)
    with pytest.raises(MuseError) as raised:
        muse.session({"hatch_sess": "old", "other": "kept"}, {})
    assert raised.value.code == code
    assert raised.value.partial.cookies == {"hatch_sess": "rotated", "other": "kept"}


@pytest.mark.parametrize(
    "failure,code",
    [
        (MuseError("browser_unavailable", 503), "browser_unavailable"),
        (BrowserError("selector timed out"), "quota_unavailable"),
        # page.evaluate returned null after the element disappeared.
        (TypeError("the JSON object must be str, not NoneType"), "quota_unavailable"),
    ],
)
def test_quota_failures_keep_the_refreshed_session(muse, monkeypatch, failure, code):
    refreshed = SessionResult({"hatch_sess": "rotated"}, {}, "RUNNING")
    monkeypatch.setattr(muse, "session", lambda *args, **kwargs: refreshed)

    def fail(*_args):
        raise failure

    monkeypatch.setattr(muse, "_read_quota", fail)
    with pytest.raises(MuseError) as raised:
        muse.quota({"hatch_sess": "old"}, {})
    assert raised.value.code == code
    assert raised.value.partial is refreshed
    assert muse.browser_lock.acquire(blocking=False)  # Released after failure.


def test_non_latin1_proxy_credentials_are_a_proxy_error(muse, monkeypatch):
    monkeypatch.setattr(muse, "_request", lambda *a, **k: pytest.fail("must not send"))
    proxy = {
        "server": "http://proxy.example.com:8080",
        "username": "user",
        "password": "密码",
    }
    with pytest.raises(MuseError) as raised:
        muse.session({"hatch_sess": "value"}, {}, proxy)
    assert raised.value.code == "proxy_error"


def test_proxy_credentials_outside_latin1_are_rejected_when_saved(tmp_path):
    with TestClient(create_app(Settings(_env_file=None, data_dir=tmp_path))) as client:
        account = client.post(
            "/api/accounts", json={"label": "A", "cookieText": "hatch_sess=value"}
        ).json()
        path = f"/api/accounts/{account['id']}/proxy"
        for proxy in [
            {
                "server": "http://proxy.example.com:8080",
                "username": "user",
                "password": "密码",
            },
            {
                "server": "http://proxy.example.com:8080",
                "username": "người",
                "password": "pw",
            },
        ]:
            response = client.put(path, json={"proxy": proxy})
            assert response.status_code == 422
            assert "密码" not in response.text
        assert client.get(f"/api/accounts/{account['id']}").json()["proxy"] is None


def test_partial_result_without_session_cookie_marks_account_invalid(tmp_path):
    class ExpiredDuringKeepAlive:
        def session(self, cookies, expiries, proxy, wake=False):
            raise MuseError(
                "session_invalid", 401, partial=SessionResult({"other": "x"}, {}, None)
            )

    with TestClient(create_app(Settings(_env_file=None, data_dir=tmp_path))) as client:
        account = client.post(
            "/api/accounts",
            json={"label": "A", "cookieText": "hatch_sess=value; other=y"},
        ).json()
        client.app.state.muse_client = ExpiredDuringKeepAlive()
        response = client.post(f"/api/accounts/{account['id']}/keep-alive")
        assert response.status_code == 200
        assert (
            response.json()["ok"] is False
            and response.json()["code"] == "session_invalid"
        )
        stored = client.get(f"/api/accounts/{account['id']}").json()
        assert (
            stored["sessionStatus"] == "invalid"
            and stored["lastError"] == "session_invalid"
        )
        assert stored["cookieCount"] == 2  # Previous credentials kept.


def test_account_operations_hold_nothing_after_release():
    operations = AccountOperations()
    with operations.acquire("a"):
        with pytest.raises(AccountBusyError):
            with operations.acquire("a"):
                pass
        with operations.acquire("b"):
            pass
    assert operations._busy == set()


class FakePage:
    """Has no wait_for_function: muse.ai's CSP blocks Playwright's in-page
    predicate compilation, so the reader must poll with evaluate()."""

    def __init__(self, ready_after_clicks):
        self.clicks = 0
        self.ready_after_clicks = ready_after_clicks

    def evaluate(self, expression):
        return '{"x": 10, "y": 20}' if expression == "target" else None

    @property
    def mouse(self):
        page = self

        class Mouse:
            def click(self, x, y):
                page.clicks += 1

        return Mouse()

    def wait_for_timeout(self, _ms):
        pass


def test_click_until_polls_without_wait_for_function_and_retries_click():
    page = FakePage(ready_after_clicks=2)
    result = MuseClient._click_until(
        page,
        "target",
        lambda: "open" if page.clicks >= page.ready_after_clicks else None,
        timeout=5,
        settle=0,
    )
    assert result == "open" and page.clicks == 2


def test_click_until_gives_up_as_quota_unavailable():
    page = FakePage(ready_after_clicks=99)
    with pytest.raises(MuseError) as raised:
        MuseClient._click_until(page, "missing", lambda: None, timeout=0.05)
    assert raised.value.code == "quota_unavailable" and page.clicks == 0


class RecordingSession:
    """requests.Session stand-in: records headers, answers per path."""

    def __init__(self, answers):
        self.answers, self.calls = answers, []

    def request(self, method, url, headers=None, **kwargs):
        path = url.split("muse.ai", 1)[-1] if "muse.ai" in url else url
        self.calls.append((method, path, headers))
        status, body = self.answers[(method, path)]
        response = FakeResponse(body)
        response.status_code = status
        return response


def test_requests_send_same_origin_fetch_metadata(muse):
    session = RecordingSession({("GET", "/api/session"): (200, {"status": "assigned"})})
    muse._request(session, "GET", "/api/session", {"hatch_sess": "x"}, {})
    headers = session.calls[0][2]
    assert headers["Sec-Fetch-Site"] == "same-origin"
    assert headers["Sec-Fetch-Mode"] == "cors" and headers["Sec-Fetch-Dest"] == "empty"


def test_rejected_wake_keeps_the_session_and_reports_why(muse, monkeypatch):
    session = RecordingSession(
        {
            ("GET", "/api/session"): (
                200,
                {"status": "assigned", "vm_id": "vm-1", "vm_state": "SLEEPING"},
            ),
            ("POST", "/api/hatch/vm/wake"): (403, {}),
        }
    )
    monkeypatch.setattr(
        "app.integrations.muse.client.requests.Session",
        lambda: _ContextSession(session),
    )
    result = muse.session({"hatch_sess": "x"}, {}, wake=True)
    assert result.verified is True and result.ok is False
    assert result.code == "wake_failed"
    assert result.detail == "POST /api/hatch/vm/wake returned HTTP 403"


def test_http_errors_say_which_step_failed(muse):
    session = RecordingSession({("GET", "/api/session"): (403, {})})
    with pytest.raises(MuseError) as raised:
        muse._request(session, "GET", "/api/session", {"hatch_sess": "x"}, {})
    assert raised.value.code == "access_denied"
    assert raised.value.detail == "GET /api/session returned HTTP 403"


class _ContextSession:
    def __init__(self, inner):
        self.inner, self.trust_env = inner, True

    def __enter__(self):
        return self.inner

    def __exit__(self, *exc):
        return False
