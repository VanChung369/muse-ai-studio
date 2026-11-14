import hashlib
import re
from datetime import timedelta

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, select, update

from app.core.config import BACKEND_DIR, Settings
from app.db.session import Database
from app.main import create_app
from app.models import ApiKey
from app.tasks.coordinator import utcnow


@pytest.fixture
def client(tmp_path):
    with TestClient(
        create_app(
            Settings(_env_file=None, data_dir=tmp_path, session_refresh_minutes=0)
        )
    ) as client:
        yield client


def test_create_list_reveal_revoke_and_ciphertext(client):
    response = client.post("/api/api-keys", json={"name": "  Zapier  "})
    assert response.status_code == 201, response.text
    key = response.json()
    assert re.fullmatch(r"sk-muse-[0-9a-f]{48}", key["key"])
    assert key["masked"] == "sk-muse-…" + key["key"][-4:]
    assert key["name"] == "Zapier" and key["lastUsedAt"] is None
    assert key["createdAt"].endswith("Z")
    second = client.post("/api/api-keys", json={"name": "Second"}).json()
    listed = client.get("/api/api-keys").json()
    assert [item["id"] for item in listed] == [second["id"], key["id"]]
    assert listed[1] == {k: v for k, v in key.items() if k != "key"}
    assert client.post(f"/api/api-keys/{key['id']}/reveal").json() == {
        "key": key["key"]
    }
    with client.app.state.database.sessions() as session:
        stored = session.get(ApiKey, key["id"])
        assert stored.key_hash == hashlib.sha256(key["key"].encode()).hexdigest()
        assert stored.key_hash != key["key"]
        assert key["key"] not in stored.encrypted_key
        assert (
            client.app.state.account_vault.decrypt_text(stored.encrypted_key)
            == key["key"]
        )
    assert client.delete(f"/api/api-keys/{key['id']}").status_code == 204
    assert len(client.get("/api/api-keys").json()) == 1
    for response in (
        client.post(f"/api/api-keys/{key['id']}/reveal"),
        client.delete(f"/api/api-keys/{key['id']}"),
        client.post("/api/api-keys/missing/reveal"),
    ):
        assert response.status_code == 404
        assert response.json()["detail"]["code"] == "api_key_not_found"
    with client.app.state.database.sessions() as session:
        assert session.get(ApiKey, key["id"]).revoked_at is not None


@pytest.mark.parametrize("name", ["", "   ", "x" * 61, None, 12])
def test_bad_names(client, name):
    assert client.post("/api/api-keys", json={"name": name}).status_code == 422
    assert client.get("/api/api-keys").json() == []


def test_trim_before_checking_name_length(client):
    response = client.post("/api/api-keys", json={"name": "  " + "x" * 60 + "  "})
    assert response.status_code == 201
    assert response.json()["name"] == "x" * 60


def test_limit_counts_only_active_keys(client):
    for i in range(20):
        response = client.post("/api/api-keys", json={"name": str(i)})
        assert response.status_code == 201
    response = client.post("/api/api-keys", json={"name": "One too many"})
    assert response.status_code == 409
    assert response.json()["detail"]["code"] == "too_many_keys"
    assert len(client.get("/api/api-keys").json()) == 20
    key = client.get("/api/api-keys").json()[0]
    assert client.delete(f"/api/api-keys/{key['id']}").status_code == 204
    assert client.post("/api/api-keys", json={"name": "Replacement"}).status_code == 201


def test_last_used_is_throttled_and_moves(client):
    key = client.post("/api/api-keys", json={"name": "Usage"}).json()
    headers = {"Authorization": "Bearer " + key["key"]}
    assert client.get("/v1/models", headers=headers).status_code == 200
    first = client.get("/api/api-keys").json()[0]["lastUsedAt"]
    assert first is not None and first.endswith("Z")
    assert client.get("/v1/models", headers=headers).status_code == 200
    assert client.get("/api/api-keys").json()[0]["lastUsedAt"] == first
    old = utcnow() - timedelta(minutes=2)
    with client.app.state.database.sessions() as session:
        session.execute(
            update(ApiKey).where(ApiKey.id == key["id"]).values(last_used_at=old)
        )
        session.commit()
    assert client.get("/v1/models", headers=headers).status_code == 200
    with client.app.state.database.sessions() as session:
        assert session.get(ApiKey, key["id"]).last_used_at > old


def test_key_reveals_after_restart_without_accounts(tmp_path):
    settings = Settings(_env_file=None, data_dir=tmp_path, session_refresh_minutes=0)
    with TestClient(create_app(settings)) as client:
        key = client.post("/api/api-keys", json={"name": "Persistent"}).json()
    with TestClient(create_app(settings)) as client:
        assert client.post(f"/api/api-keys/{key['id']}/reveal").json() == {
            "key": key["key"]
        }


def test_migration_downgrade_and_upgrade(tmp_path):
    database = Database(Settings(_env_file=None, data_dir=tmp_path))
    try:
        database.migrate()
        config = Config(str(BACKEND_DIR / "alembic.ini"))
        with database.migration_connection() as connection:
            config.attributes["connection"] = connection
            command.downgrade(config, "0019_long_films")
            assert "api_keys" not in inspect(connection).get_table_names()
        database.migrate()
        with database.sessions() as session:
            assert list(session.scalars(select(ApiKey))) == []
    finally:
        database.close()
