import json

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import inspect, text

from app.core.config import BACKEND_DIR, Settings
from app.db.session import Database
from app.main import create_app


EMPTY_LIST = {
    'items': [], 'total': 0, 'nextCursor': None, 'featured': None,
    'counts': {'all': 0, 'inProgress': 0, 'completed': 0, 'cancelled': 0},
}


def summary(project):
    """List items omit the potentially large `idea` and `scenes` fields."""
    return {key: value for key, value in project.items() if key not in ('idea', 'scenes', 'characterBible', 'visualStyle', 'scriptRevision', 'look', 'continuity', 'language', 'mute')}


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def test_create_list_details_and_restart(settings):
    with TestClient(create_app(settings)) as client:
        assert client.get('/api/projects').json() == EMPTY_LIST
        response = client.post('/api/projects', json={
            'name': '  A morning in Đà Lạt  ', 'idea': '  A quiet story.  ',
            'durationSeconds': 65, 'aspectRatio': '9:16',
        })
        assert response.status_code == 201
        project = response.json()
        assert project['name'] == 'A morning in Đà Lạt'
        assert project['idea'] == 'A quiet story.'
        assert project['durationSeconds'] == 65
        assert project['aspectRatio'] == '9:16'
        assert project['status'] == 'draft'
        assert project['scenes'] == []
        assert project['sceneCount'] == project['completedScenes'] == 0
        assert project['createdAt'].endswith('Z')
        assert project['updatedAt'].endswith('Z')
        assert client.get(response.headers['location']).json() == project
        # Duplicate names are valid; identity belongs to the generated ID.
        second = client.post('/api/projects', json={'name': project['name']}).json()
        assert second['id'] != project['id']
        assert second['durationSeconds'] == 60
        assert second['aspectRatio'] == '16:9'
        listed = client.get('/api/projects').json()
        assert listed['items'] == [summary(second), summary(project)]
        assert listed['total'] == 2 and listed['nextCursor'] is None
        assert listed['counts'] == {'all': 2, 'inProgress': 2, 'completed': 0, 'cancelled': 0}
        assert listed['featured'] == {**summary(second), 'previewScenes': []}
    with TestClient(create_app(settings)) as client:
        assert client.get(f"/api/projects/{project['id']}").json() == project
        assert client.get('/api/projects').json()['total'] == 2
        assert client.get('/api/health').status_code == 200


@pytest.mark.parametrize('overrides', [
    {'name': ''}, {'name': '   '}, {'name': 'x' * 101},
    {'idea': 'x' * 12001}, {'durationSeconds': 9}, {'durationSeconds': 12},
    {'durationSeconds': 305}, {'durationSeconds': '60'}, {'durationSeconds': True},
    {'aspectRatio': '4:3'}, {'status': 'completed'}, {'id': 'injected'},
])
def test_invalid_input_does_not_insert(client, overrides):
    response = client.post('/api/projects', json={'name': 'Valid name', **overrides})
    assert response.status_code == 422
    assert client.get('/api/projects').json() == EMPTY_LIST


def test_missing_project(client):
    response = client.get('/api/projects/missing')
    assert response.status_code == 404
    assert response.json()['detail']['code'] == 'project_not_found'


def test_migrate_existing_baseline_and_model_consistency(settings):
    database = Database(settings)
    try:
        database.prepare()
        config = Config(str(BACKEND_DIR / 'alembic.ini'))
        with database.engine.begin() as connection:
            config.attributes['connection'] = connection
            command.upgrade(config, '0001_baseline')
            assert 'projects' not in inspect(connection).get_table_names()
        database.migrate()
        with database.engine.begin() as connection:
            config.attributes['connection'] = connection
            command.check(config)
            assert 'projects' in inspect(connection).get_table_names()
    finally:
        database.close()


def test_openapi_snapshot():
    snapshot = json.loads((BACKEND_DIR / 'openapi.json').read_text())
    assert create_app().openapi() == snapshot


def collect_pages(client, **params):
    """Follow nextCursor until the last page, returning names in order."""
    names, cursor = [], None
    while True:
        page = client.get('/api/projects', params={**params, **({'cursor': cursor} if cursor else {})}).json()
        names += [item['name'] for item in page['items']]
        cursor = page['nextCursor']
        if cursor is None:
            return names, page


def set_status(settings, statuses):
    database = Database(settings)
    try:
        with database.engine.begin() as connection:
            for name, value in statuses.items():
                connection.execute(text('UPDATE projects SET status = :status WHERE name = :name'), {'status': value, 'name': name})
    finally:
        database.close()


def test_pagination_sorting_search_and_filters(settings):
    names = ['Đà Lạt sáng', 'Hội An đêm', 'alpha', 'Beta', 'zeta 100%', 'Gamma']
    durations = [60, 120, 60, 300, 10, 120]
    with TestClient(create_app(settings)) as client:
        for name, duration in zip(names, durations):
            client.post('/api/projects', json={'name': name, 'durationSeconds': duration})

        # Newest first, two per page, no duplicates or gaps.
        newest, last = collect_pages(client, limit=2)
        assert newest == list(reversed(names))
        assert last['total'] == 6

        # Case- and accent-insensitive name order.
        by_name, _ = collect_pages(client, sort='name', limit=4)
        assert by_name == ['alpha', 'Beta', 'Đà Lạt sáng', 'Gamma', 'Hội An đêm', 'zeta 100%']

        # Longest first; equal durations fall back to most recently updated.
        by_duration, _ = collect_pages(client, sort='duration', limit=1)
        assert by_duration == ['Beta', 'Gamma', 'Hội An đêm', 'alpha', 'Đà Lạt sáng', 'zeta 100%']

        # Search ignores case, accents, and đ; LIKE wildcards are literal.
        assert collect_pages(client, q='  DA LAT ')[0] == ['Đà Lạt sáng']
        assert collect_pages(client, q='hoi an dem')[0] == ['Hội An đêm']
        assert collect_pages(client, q='%')[0] == ['zeta 100%']
        assert collect_pages(client, q='_')[0] == []

        # A project created between page requests does not shift later pages.
        first = client.get('/api/projects', params={'limit': 3}).json()
        client.post('/api/projects', json={'name': 'Created mid-scroll'})
        second = client.get('/api/projects', params={'limit': 3, 'cursor': first['nextCursor']}).json()
        assert [item['name'] for item in first['items'] + second['items']] == list(reversed(names))

    set_status(settings, {'alpha': 'completed', 'Beta': 'cancelled', 'Gamma': 'failed', 'Hội An đêm': 'ready'})
    with TestClient(create_app(settings)) as client:
        page = client.get('/api/projects', params={'status': 'inProgress'}).json()
        # Failed projects still need work, so they count as in progress.
        assert {item['name'] for item in page['items']} == {'Created mid-scroll', 'zeta 100%', 'Gamma', 'Hội An đêm', 'Đà Lạt sáng'}
        assert page['total'] == 5
        assert page['counts'] == {'all': 7, 'inProgress': 5, 'completed': 1, 'cancelled': 1}
        # Ready projects are featured before newer in-progress ones; filters do not apply.
        assert page['featured']['name'] == 'Hội An đêm'
        completed = client.get('/api/projects', params={'status': 'completed', 'q': 'zzz'}).json()
        assert completed['items'] == [] and completed['total'] == 0
        assert completed['counts']['all'] == 7 and completed['featured']['name'] == 'Hội An đêm'


@pytest.mark.parametrize('params', [
    {'cursor': 'not-base64!'}, {'cursor': 'e30'},
    {'limit': 0}, {'limit': 101}, {'status': 'failed'}, {'sort': 'created'},
])
def test_invalid_list_parameters(client, params):
    client.post('/api/projects', json={'name': 'Only project'})
    response = client.get('/api/projects', params=params)
    assert response.status_code == (400 if 'cursor' in params else 422)
    if 'cursor' in params:
        assert response.json()['detail']['code'] == 'invalid_cursor'


def test_cursor_from_another_sort_is_rejected(client):
    for name in ['one', 'two']:
        client.post('/api/projects', json={'name': name})
    cursor = client.get('/api/projects', params={'limit': 1}).json()['nextCursor']
    response = client.get('/api/projects', params={'sort': 'name', 'cursor': cursor})
    assert response.status_code == 400


def test_migration_backfills_name_key(settings):
    database = Database(settings)
    try:
        database.prepare()
        config = Config(str(BACKEND_DIR / 'alembic.ini'))
        with database.engine.begin() as connection:
            config.attributes['connection'] = connection
            command.upgrade(config, '0002_projects')
            connection.execute(text(
                "INSERT INTO projects (id, name, idea, aspect_ratio, duration_seconds, status, created_at, updated_at) "
                "VALUES ('legacy', 'Đêm Hội An', '', '16:9', 60, 'draft', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
            ))
        database.migrate()
        with database.engine.begin() as connection:
            assert connection.execute(text("SELECT name_key FROM projects WHERE id = 'legacy'")).scalar_one() == 'dem hoi an'
    finally:
        database.close()
