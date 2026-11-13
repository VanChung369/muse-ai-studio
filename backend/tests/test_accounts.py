import json
import stat
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.account_vault import AccountVault
from app.core.config import Settings
from app.main import create_app
from app.models import Account

SECRET = "test-only-session-fixture-never-a-real-cookie"
PUBLIC_FIELDS = {
    "id",
    "label",
    "enabled",
    "cookieCount",
    "sessionStatus",
    "createdAt",
    "updatedAt",
    "expiresAt",
    "lastUsedAt",
    "lastCheckedAt",
    "lastKeepaliveAt",
    "quotaCheckedAt",
    "notes",
    "lastError",
    "runningTasks",
    "credentialVersion",
    "proxy",
    "quota",
}


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def account_input(**overrides):
    return {
        "label": " Creative account ",
        "cookieText": f"hatch_sess={SECRET}; optional=value",
        **overrides,
    }


def test_import_list_metadata_encryption_and_restart(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/accounts").json() == {"items": [], "total": 0}
        response = client.post("/api/accounts", json=account_input())
        assert response.status_code == 201
        account = response.json()
        assert set(account) == PUBLIC_FIELDS
        assert account["label"] == "Creative account"
        assert account["enabled"] is True and account["sessionStatus"] == "unverified"
        assert account["cookieCount"] == 2
        assert account["createdAt"].endswith("Z") and account["updatedAt"].endswith("Z")
        assert client.get(response.headers["location"]).json() == account
        assert client.get("/api/accounts").json() == {"items": [account], "total": 1}
        assert SECRET not in response.text
        assert response.headers["cache-control"] == "no-store"
        with client.app.state.database.sessions() as session:
            stored = session.get(Account, account["id"])
            ciphertext = stored.encrypted_cookies
            assert SECRET not in ciphertext and SECRET not in stored.session_fingerprint
            assert (
                client.app.state.account_vault.decrypt(ciphertext)["hatch_sess"]
                == SECRET
            )
    assert (
        stat.S_IMODE((settings.data_dir / "account-secret.key").stat().st_mode) == 0o600
    )
    # Both the DB and its WAL must contain only encrypted session data.
    for path in settings.data_dir.glob("*.db*"):
        assert SECRET.encode() not in path.read_bytes()
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/accounts").json()["items"] == [account]
        assert (
            client.app.state.account_vault.decrypt(ciphertext)["hatch_sess"] == SECRET
        )


@pytest.mark.parametrize(
    "cookie_text",
    [
        f"Cookie: hatch_sess={SECRET}",
        json.dumps({"hatch_sess": SECRET}),
        json.dumps(
            [
                {
                    "name": "hatch_sess",
                    "value": SECRET,
                    "domain": ".muse.ai",
                    "expirationDate": 2000000000,
                }
            ]
        ),
        json.dumps([{"name": "hatch_sess", "value": SECRET, "domain": "www.muse.ai"}]),
    ],
)
def test_import_supported_formats(client, cookie_text):
    response = client.post("/api/accounts", json=account_input(cookieText=cookie_text))
    assert response.status_code == 201
    assert response.json()["cookieCount"] == 1
    assert response.json()["sessionStatus"] == "unverified"


def test_duplicate_session_with_different_cookie_order_is_not_added(client):
    first = client.post("/api/accounts", json=account_input()).json()
    response = client.post(
        "/api/accounts",
        json=account_input(cookieText=f"optional=changed; hatch_sess={SECRET}"),
    )
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "account_exists"
    assert SECRET not in response.text
    assert client.get("/api/accounts").json()["items"] == [first]


@pytest.mark.parametrize(
    "cookie_text,code",
    [
        ("missing-equals", "invalid_cookies"),
        ("{}", "invalid_cookies"),
        ("[]", "invalid_cookies"),
        ("{invalid}", "invalid_cookies"),
        ("optional=value", "missing_session"),
        ("hatch_sess=", "missing_session"),
        (json.dumps({"hatch_sess": 1}), "invalid_cookies"),
        (
            json.dumps(
                [
                    {
                        "name": "hatch_sess",
                        "value": SECRET,
                        "domain": "muse.ai.attacker.example",
                    }
                ]
            ),
            "invalid_cookies",
        ),
        (
            json.dumps([{"name": "hatch_sess", "value": SECRET, "domain": 123}]),
            "invalid_cookies",
        ),
        (json.dumps({"hatch_sess": "x" * 8193}), "invalid_cookies"),
    ],
)
def test_invalid_cookies_never_insert_or_echo_input(client, cookie_text, code):
    response = client.post("/api/accounts", json=account_input(cookieText=cookie_text))
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == code
    assert SECRET not in response.text
    assert client.get("/api/accounts").json()["total"] == 0


@pytest.mark.parametrize(
    "payload",
    [
        account_input(label="  "),
        account_input(label="x" * 101),
        account_input(cookieText="x" * (1_048_576 + 1)),
        account_input(cookieText={"hatch_sess": SECRET}),
        account_input(extra=SECRET),
        {"label": "Missing session"},
        {"cookieText": f"hatch_sess={SECRET}"},
    ],
)
def test_request_validation_redacts_credentials(client, payload):
    response = client.post("/api/accounts", json=payload)
    assert response.status_code == 422
    assert SECRET not in response.text
    for item in response.json()["detail"]:
        assert "input" not in item and "ctx" not in item
    assert client.get("/api/accounts").json()["total"] == 0


def test_rename_disable_enable_and_delete_preserve_projects(client):
    project = client.post("/api/projects", json={"name": "Keep project"}).json()
    account = client.post("/api/accounts", json=account_input()).json()
    path = f"/api/accounts/{account['id']}"
    renamed = client.patch(path, json={"label": " Updated account "})
    assert renamed.status_code == 200 and renamed.json()["label"] == "Updated account"
    assert renamed.json()["createdAt"] == account["createdAt"]
    assert client.patch(path, json={"enabled": False}).json()["enabled"] is False
    enabled = client.patch(path, json={"enabled": True}).json()
    assert enabled["enabled"] is True and enabled["sessionStatus"] == "unverified"
    assert set(enabled) == PUBLIC_FIELDS
    response = client.delete(path)
    assert response.status_code == 204 and response.content == b""
    assert client.get("/api/accounts").json()["total"] == 0
    assert client.get(f"/api/projects/{project['id']}").json() == project
    assert client.get(path).status_code == client.delete(path).status_code == 404
    # Deleting also removes the duplicate fingerprint, allowing a later import.
    assert client.post("/api/accounts", json=account_input()).status_code == 201


@pytest.mark.parametrize(
    "values",
    [
        {},
        {"enabled": "false"},
        {"enabled": None},
        {"label": None},
        {"label": "  "},
        {"cookieText": SECRET},
        {"sessionStatus": "ready"},
    ],
)
def test_invalid_patch_is_rejected(client, values):
    account = client.post("/api/accounts", json=account_input()).json()
    path = f"/api/accounts/{account['id']}"
    response = client.patch(path, json=values)
    assert response.status_code == 422 and SECRET not in response.text
    assert client.get(path).json() == account


def test_missing_account(client):
    assert client.get("/api/accounts/missing").status_code == 404
    assert (
        client.patch("/api/accounts/missing", json={"enabled": False}).status_code
        == 404
    )
    assert client.delete("/api/accounts/missing").status_code == 404


def test_concurrent_duplicate_imports(client):
    barrier = Barrier(2)

    def import_one(index):
        barrier.wait(timeout=5)
        return client.post(
            "/api/accounts", json=account_input(label=f"Editor {index}")
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(import_one, [1, 2])) == [201, 409]
    assert client.get("/api/accounts").json()["total"] == 1


def test_missing_or_wrong_key_is_not_silently_replaced(settings):
    with TestClient(create_app(settings)) as client:
        assert client.post("/api/accounts", json=account_input()).status_code == 201
    key_path = settings.data_dir / "account-secret.key"
    original_key = key_path.read_bytes()
    key_path.unlink()
    with pytest.raises(RuntimeError, match="key is missing"):
        with TestClient(create_app(settings)):
            pass
    assert not key_path.exists()
    wrong_key = Fernet.generate_key()
    key_path.write_bytes(wrong_key)
    with pytest.raises(RuntimeError, match="does not match"):
        with TestClient(create_app(settings)):
            pass
    assert key_path.read_bytes() == wrong_key
    key_path.write_bytes(original_key)
    with TestClient(create_app(settings)) as client:
        assert client.get("/api/accounts").json()["total"] == 1


def test_concurrent_vault_creation_is_atomic(tmp_path):
    path = tmp_path / "account-secret.key"

    def prepare(_index):
        vault = AccountVault(path)
        vault.prepare()
        return vault.fingerprint(SECRET)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert len(set(pool.map(prepare, [1, 2]))) == 1
    assert stat.S_IMODE(path.stat().st_mode) == 0o600


def stored_cookies(client, account_id):
    with client.app.state.database.sessions() as session:
        account = session.get(Account, account_id)
        return client.app.state.account_vault.decrypt(
            account.encrypted_cookies
        ), json.loads(account.cookie_expiries)


# Users paste whatever they copied; everything that is not a usable muse.ai
# cookie is skipped instead of failing the import.
@pytest.mark.parametrize(
    "cookie_text,expected",
    [
        (
            f'"hatch_sess={SECRET}; wd=1904x334"',
            {"hatch_sess": SECRET, "wd": "1904x334"},
        ),
        (
            f"_ga=GA1.1;\n hatch_sess={SECRET}; Path=/; HttpOnly; Secure",
            {"_ga": "GA1.1", "hatch_sess": SECRET},
        ),
        (
            f":authority: muse.ai\naccept: */*\ncookie: _ga=x; hatch_sess={SECRET}\nuser-agent: Mozilla/5.0",
            {"_ga": "x", "hatch_sess": SECRET},
        ),
        (
            f"curl 'https://muse.ai/api/session' \\\n  -H 'accept: */*' \\\n  -b 'hatch_sess={SECRET}; _ga=x'",
            {"hatch_sess": SECRET, "_ga": "x"},
        ),
        (
            f"curl 'https://muse.ai/' -H 'Cookie: hatch_sess={SECRET}; a=b'",
            {"hatch_sess": SECRET, "a": "b"},
        ),
        (
            f'fetch("https://muse.ai/api", {{"headers": {{"accept": "*/*", "cookie": "hatch_sess={SECRET}; a=b"}}}});',
            {"hatch_sess": SECRET, "a": "b"},
        ),
        (
            json.dumps(
                {
                    "cookies": [
                        {"name": "hatch_sess", "value": SECRET, "domain": ".muse.ai"}
                    ],
                    "origins": [],
                }
            ),
            {"hatch_sess": SECRET},
        ),
        # A full browser export: other sites skipped; duplicate names prefer muse.ai itself.
        (
            json.dumps(
                [
                    {"name": "SID", "value": "google", "domain": ".google.com"},
                    {"name": "_ga", "value": "sub", "domain": "www.muse.ai"},
                    {"name": "_ga", "value": "apex", "domain": ".muse.ai"},
                    {
                        "name": "hatch_sess",
                        "value": SECRET,
                        "domain": "muse.ai.attacker.example",
                    },
                    {"name": "hatch_sess", "value": SECRET, "domain": "muse.ai"},
                    "not-a-cookie",
                    {"name": "bad", "value": 1},
                ]
            ),
            {"_ga": "apex", "hatch_sess": SECRET},
        ),
        (
            f"# Netscape HTTP Cookie File\n.google.com\tTRUE\t/\tTRUE\t2000000000\tSID\tg\n#HttpOnly_.muse.ai\tTRUE\t/\tTRUE\t2000000000\thatch_sess\t{SECRET}\n",
            {"hatch_sess": SECRET},
        ),
        (
            f"hatch_sess\t{SECRET}\tmuse.ai\t/\t2033-05-18T03:33:20.000Z\t40\n_ga\tGA1\t.muse.ai\t/\tSession\t10",
            {"hatch_sess": SECRET, "_ga": "GA1"},
        ),
        (f"hatch_sess={SECRET}; hatch_sess=second", {"hatch_sess": SECRET}),
        # A line break cannot inject a header: the stray line is skipped.
        (f"hatch_sess={SECRET}\nX-Header: injected", {"hatch_sess": SECRET}),
    ],
)
def test_import_accepts_pasted_formats(client, cookie_text, expected):
    response = client.post("/api/accounts", json=account_input(cookieText=cookie_text))
    assert response.status_code == 201, response.text
    assert SECRET not in response.text
    cookies, _ = stored_cookies(client, response.json()["id"])
    assert cookies == expected


def test_import_keeps_expiry_from_exports(client):
    for text in [
        json.dumps(
            [
                {
                    "name": "hatch_sess",
                    "value": SECRET,
                    "domain": ".muse.ai",
                    "expirationDate": 2000000000,
                }
            ]
        ),
        f".muse.ai\tTRUE\t/\tTRUE\t2000000000\thatch_sess\t{SECRET}",
        f"hatch_sess\t{SECRET}\tmuse.ai\t/\t2033-05-18T03:33:20.000Z\t40",
    ]:
        account = client.post(
            "/api/accounts", json=account_input(cookieText=text)
        ).json()
        assert account["expiresAt"] == "2033-05-18T03:33:20Z"
        client.delete(f"/api/accounts/{account['id']}")


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/accounts", account_input(cookieText="no cookies here")),
        ("post", "/api/accounts", account_input(cookieText="optional=value")),
        ("get", "/api/accounts/missing", None),
        ("patch", "/api/accounts/missing", {"label": "Name"}),
        (
            "put",
            "/api/accounts/missing/cookies",
            {"cookieText": f"hatch_sess={SECRET}"},
        ),
    ],
)
def test_error_responses_are_not_cached(client, method, path, body):
    response = getattr(client, method)(
        path, **({"json": body} if body is not None else {})
    )
    assert response.status_code in (404, 422)
    assert response.headers["cache-control"] == "no-store"


def test_duplicate_import_error_is_not_cached(client):
    client.post("/api/accounts", json=account_input())
    response = client.post("/api/accounts", json=account_input(label="Again"))
    assert response.status_code == 409
    assert response.headers["cache-control"] == "no-store"


def test_list_order_does_not_change_when_accounts_are_updated(client):
    ids = [
        client.post(
            "/api/accounts",
            json=account_input(
                label=f"A{index}", cookieText=f"hatch_sess={SECRET}-{index}"
            ),
        ).json()["id"]
        for index in range(3)
    ]
    before = [item["id"] for item in client.get("/api/accounts").json()["items"]]
    assert before == list(reversed(ids))
    client.patch(f"/api/accounts/{ids[0]}", json={"enabled": False})
    client.patch(f"/api/accounts/{ids[1]}", json={"label": "Renamed"})
    assert [
        item["id"] for item in client.get("/api/accounts").json()["items"]
    ] == before


def test_vault_key_is_created_without_hard_link_support(tmp_path, monkeypatch):
    def no_links(*_args):
        raise PermissionError("hard links unsupported")

    monkeypatch.setattr("app.core.account_vault.os.link", no_links)
    vault = AccountVault(tmp_path / "account-secret.key")
    vault.prepare()
    assert vault.decrypt(vault.encrypt({"hatch_sess": SECRET})) == {
        "hatch_sess": SECRET
    }
    assert stat.S_IMODE((tmp_path / "account-secret.key").stat().st_mode) == 0o600
    assert [path.name for path in tmp_path.iterdir()] == ["account-secret.key"]


def test_fingerprint_uses_a_subkey_and_old_fingerprints_are_refreshed(settings):
    with TestClient(create_app(settings)) as client:
        account = client.post("/api/accounts", json=account_input()).json()
        vault = client.app.state.account_vault
        key = (settings.data_dir / "account-secret.key").read_bytes()
        import hashlib, hmac

        legacy = hmac.new(
            key, b"muse-session:" + SECRET.encode(), hashlib.sha256
        ).hexdigest()
        assert vault.fingerprint(SECRET) != legacy
        with client.app.state.database.sessions() as session:
            stored = session.get(Account, account["id"])
            stored.session_fingerprint = (
                legacy  # As written by the previous derivation.
            )
            session.commit()
    with TestClient(create_app(settings)) as client:
        # Startup refreshes it, so duplicate detection still works.
        response = client.post("/api/accounts", json=account_input(label="Duplicate"))
        assert response.status_code == 409
