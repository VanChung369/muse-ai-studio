from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select, text

from app.core.config import Settings
from app.db.session import Database
from app.main import create_app
from app.models import Scene


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def create_scripted_project(client, name):
    project = client.post('/api/projects', json={'name': name, 'durationSeconds': 10}).json()
    response = client.put(f"/api/projects/{project['id']}/script", json={
        'expectedRevision': 0,
        'scenes': [{'number': 1, 'title': 'Opening', 'prompt': 'A quiet morning.', 'durationSeconds': 10}],
    })
    assert response.status_code == 200
    return response.json()


def test_delete_cascades_scenes_preserves_others_and_survives_restart(settings):
    with TestClient(create_app(settings)) as client:
        keep = create_scripted_project(client, 'Keep this project')
        remove = create_scripted_project(client, 'Delete this project')
        path = f"/api/projects/{remove['id']}"
        response = client.delete(path)
        assert response.status_code == 204 and response.content == b''
        assert client.get(path).status_code == 404
        assert client.get(f"/api/projects/{keep['id']}").json() == keep
        page = client.get('/api/projects').json()
        assert [item['id'] for item in page['items']] == [keep['id']]
        assert page['total'] == page['counts']['all'] == page['counts']['inProgress'] == 1
        assert page['featured']['id'] == keep['id']
        with client.app.state.database.sessions() as session:
            assert session.scalar(select(func.count()).select_from(Scene).where(Scene.project_id == remove['id'])) == 0
            assert session.scalar(select(func.count()).select_from(Scene).where(Scene.project_id == keep['id'])) == 1
    with TestClient(create_app(settings)) as client:
        assert client.get(path).status_code == 404
        assert client.get('/api/projects').json()['total'] == 1


@pytest.mark.parametrize('project_status', ['draft', 'ready', 'failed', 'completed', 'cancelled', 'planning', 'rendering', 'cancelling'])
def test_delete_status_rules(client, settings, project_status):
    project = create_scripted_project(client, 'Status test')
    path = f"/api/projects/{project['id']}"
    database = Database(settings)
    try:
        with database.engine.begin() as connection:
            connection.execute(text('UPDATE projects SET status = :status WHERE id = :id'), {'status': project_status, 'id': project['id']})
    finally:
        database.close()
    previous = client.get(path).json()
    response = client.delete(path)
    if project_status in ('planning', 'rendering', 'cancelling'):
        assert response.status_code == 409
        assert response.json()['detail']['code'] == 'project_busy'
        assert client.get(path).json() == previous
    else:
        assert response.status_code == 204
        page = client.get('/api/projects').json()
        assert page['items'] == [] and page['featured'] is None
        assert page['total'] == page['counts']['all'] == 0


def test_missing_and_repeated_delete(client):
    response = client.delete('/api/projects/missing')
    assert response.status_code == 404
    assert response.json()['detail']['code'] == 'project_not_found'
    project = client.post('/api/projects', json={'name': 'Draft'}).json()
    assert client.delete(f"/api/projects/{project['id']}").status_code == 204
    assert client.delete(f"/api/projects/{project['id']}").status_code == 404


def test_concurrent_delete(client):
    project = create_scripted_project(client, 'Concurrent removal')
    barrier = Barrier(2)
    def delete(_index):
        barrier.wait(timeout=5)
        return client.delete(f"/api/projects/{project['id']}").status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(delete, [1, 2])) == [204, 404]


def test_failed_delete_preserves_project_and_scenes(settings):
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        project = create_scripted_project(client, 'Preserve on failure')
        engine = app.state.database.engine
        with engine.begin() as connection:
            connection.execute(text("CREATE TRIGGER reject_deletion AFTER DELETE ON projects BEGIN SELECT RAISE(ABORT, 'Simulated failure after deletion'); END"))
        path = f"/api/projects/{project['id']}"
        assert client.delete(path).status_code == 500
        assert client.get(path).json() == project
        assert client.get('/api/projects').json()['total'] == 1
