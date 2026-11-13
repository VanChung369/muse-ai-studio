from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import event, text

from app.core.config import BACKEND_DIR, Settings
from app.db.session import Database
from app.main import create_app


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def script(revision=0):
    return {
        'expectedRevision': revision,
        'characterBible': '  A farmer wearing a blue jacket.  ',
        'visualStyle': '  Warm cinematic lighting.  ',
        'scenes': [
            {'number': 1, 'title': '  Opening  ', 'prompt': '  Sunrise over Đà Lạt.  ', 'durationSeconds': 10, 'narration': '  A new day begins.  '},
            {'number': 2, 'title': 'Closing', 'prompt': 'A cup of coffee.', 'durationSeconds': 5},
        ],
    }


def create_project(client):
    return client.post('/api/projects', json={'name': 'Đà Lạt', 'durationSeconds': 15}).json()


def test_script_save_replace_preview_and_restart(settings):
    with TestClient(create_app(settings)) as client:
        project = create_project(client)
        assert project['scriptRevision'] == 0 and project['characterBible'] == ''
        path = f"/api/projects/{project['id']}"
        response = client.put(path + '/script', json=script())
        assert response.status_code == 200
        saved = response.json()
        assert saved['status'] == 'ready'
        assert saved['sceneCount'] == 2 and saved['completedScenes'] == 0
        assert saved['scriptRevision'] == 1
        assert saved['updatedAt'] > project['updatedAt']
        assert saved['createdAt'] == project['createdAt']
        assert saved['characterBible'] == 'A farmer wearing a blue jacket.'
        assert saved['visualStyle'] == 'Warm cinematic lighting.'
        assert saved['scenes'][0]['title'] == 'Opening'
        assert saved['scenes'][0]['narration'] == 'A new day begins.'
        assert saved['scenes'][1]['narration'] == ''
        assert client.get(path).json() == saved
        page = client.get('/api/projects').json()
        assert page['items'][0]['sceneCount'] == 2
        assert 'scenes' not in page['items'][0]
        assert page['featured']['previewScenes'] == [{'number': 1, 'title': 'Opening'}, {'number': 2, 'title': 'Closing'}]
        replacement = script(1)
        replacement['scenes'] = [
            {'number': 1, 'title': 'New ending', 'prompt': 'The new ending.', 'durationSeconds': 5},
            {'number': 2, 'title': 'New opening', 'prompt': 'The new opening.', 'durationSeconds': 10},
        ]
        saved = client.put(path + '/script', json=replacement).json()
        assert saved['scriptRevision'] == 2
        assert [s['title'] for s in saved['scenes']] == ['New ending', 'New opening']
    with TestClient(create_app(settings)) as client:
        assert client.get(path).json() == saved


@pytest.mark.parametrize('case', ['duration', 'order', 'empty', 'title', 'prompt', 'narration', 'style', 'characters', 'revision', 'extra', 'float_duration', 'too_many'])
def test_invalid_save_preserves_entire_previous_script(client, case):
    project = create_project(client)
    path = f"/api/projects/{project['id']}"
    previous = client.put(path + '/script', json=script()).json()
    invalid = script(1)
    if case == 'duration': invalid['scenes'][1]['durationSeconds'] = 10
    if case == 'order': invalid['scenes'][0]['number'] = 2
    if case == 'empty': invalid['scenes'] = []
    if case == 'title': invalid['scenes'][0]['title'] = '   '
    if case == 'prompt': invalid['scenes'][0]['prompt'] = 'x' * 6001
    if case == 'narration': invalid['scenes'][0]['narration'] = 'x' * 601
    if case == 'style': invalid['visualStyle'] = 'x' * 3001
    if case == 'characters': invalid['characterBible'] = 'x' * 10001
    if case == 'revision': invalid['expectedRevision'] = True
    if case == 'extra': invalid['status'] = 'completed'
    if case == 'float_duration': invalid['scenes'][0]['durationSeconds'] = 10.0
    if case == 'too_many': invalid['scenes'] = [dict(invalid['scenes'][0], number=i+1) for i in range(31)]
    response = client.put(path + '/script', json=invalid)
    assert response.status_code == 422
    assert client.get(path).json() == previous


def test_stale_revision_does_not_overwrite(client):
    project = create_project(client)
    path = f"/api/projects/{project['id']}"
    previous = client.put(path + '/script', json=script()).json()
    response = client.put(path + '/script', json=script())
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'script_conflict'
    assert client.get(path).json() == previous


@pytest.mark.parametrize('status', ['planning', 'rendering', 'cancelling', 'completed', 'cancelled', 'failed'])
def test_script_is_locked_outside_draft_and_ready(client, settings, status):
    project = create_project(client)
    path = f"/api/projects/{project['id']}"
    database = Database(settings)
    try:
        with database.engine.begin() as connection:
            connection.execute(text('UPDATE projects SET status = :status WHERE id = :id'), {'status': status, 'id': project['id']})
    finally:
        database.close()
    response = client.put(path + '/script', json=script())
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'script_locked'
    assert client.get(path).json()['scenes'] == []


def test_missing_project(client):
    response = client.put('/api/projects/missing/script', json=script())
    assert response.status_code == 404


def test_concurrent_script_saves(client):
    project = create_project(client)
    path = f"/api/projects/{project['id']}"
    barrier = Barrier(2)
    def save(index):
        values = script()
        values['characterBible'] = f'Editor {index}'
        barrier.wait(timeout=5)
        return client.put(path + '/script', json=values)
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(save, [1, 2]))
    assert sorted(r.status_code for r in responses) == [200, 409]
    winner = next(r.json() for r in responses if r.status_code == 200)
    assert client.get(path).json() == winner


def test_upgrade_preserves_existing_projects_and_downgrade(settings):
    database = Database(settings)
    try:
        database.prepare()
        config = Config(str(BACKEND_DIR / 'alembic.ini'))
        with database.engine.begin() as connection:
            config.attributes['connection'] = connection
            command.upgrade(config, '0003_project_list_pagination')
            connection.execute(text(
                "INSERT INTO projects (id, name, name_key, idea, aspect_ratio, duration_seconds, status, created_at, updated_at) "
                "VALUES ('legacy', 'Đà Lạt', 'da lat', 'Original idea', '16:9', 60, 'draft', '2026-01-01 00:00:00', '2026-01-01 00:00:00')"
            ))
        database.migrate()
        with database.engine.begin() as connection:
            config.attributes['connection'] = connection
            command.check(config)
            row = connection.execute(text("SELECT idea, script_revision, character_bible FROM projects WHERE id = 'legacy'")).one()
            assert tuple(row) == ('Original idea', 0, '')
            command.downgrade(config, '0003_project_list_pagination')
            assert connection.execute(text("SELECT idea FROM projects WHERE id = 'legacy'")).scalar_one() == 'Original idea'
    finally:
        database.close()


@pytest.mark.parametrize('duration', [10, 15, 300])
def test_supported_timeline_boundaries(client, duration):
    project = client.post('/api/projects', json={'name': 'Timeline', 'durationSeconds': duration}).json()
    values = script()
    values['scenes'] = [
        {'number': index + 1, 'title': f'Scene {index + 1}', 'prompt': 'A cinematic scene.', 'durationSeconds': min(10, duration - index * 10)}
        for index in range((duration + 9) // 10)
    ]
    response = client.put(f"/api/projects/{project['id']}/script", json=values)
    assert response.status_code == 200
    assert sum(scene['durationSeconds'] for scene in response.json()['scenes']) == duration
    preview = client.get('/api/projects').json()['featured']['previewScenes']
    assert len(preview) == min(6, len(values['scenes']))


def test_scene_write_failure_rolls_back_shared_metadata_and_previous_scenes(settings):
    app = create_app(settings)
    with TestClient(app, raise_server_exceptions=False) as client:
        project = create_project(client)
        path = f"/api/projects/{project['id']}"
        previous = client.put(path + '/script', json=script()).json()
        engine = app.state.database.engine
        def fail_insert(_connection, _cursor, statement, _parameters, _context, _many):
            if statement.startswith('INSERT INTO project_scenes'):
                raise RuntimeError('Simulated failure while storing replacement scenes')
        event.listen(engine, 'before_cursor_execute', fail_insert)
        try:
            values = script(1)
            values['characterBible'] = 'This must be rolled back.'
            response = client.put(path + '/script', json=values)
            assert response.status_code == 500
        finally:
            event.remove(engine, 'before_cursor_execute', fail_insert)
        assert client.get(path).json() == previous


def test_stale_revision_is_reported_before_duration_mismatch(client):
    # A client with an outdated copy may also send an outdated total duration;
    # it must learn about the conflict so it reloads instead of seeing a 422.
    project = create_project(client)
    path = f"/api/projects/{project['id']}"
    client.put(path + '/script', json=script())
    stale = script(revision=0)
    stale['scenes'][1]['durationSeconds'] = 10
    response = client.put(path + '/script', json=stale)
    assert response.status_code == 409
    assert response.json()['detail']['code'] == 'script_conflict'
    current = script(revision=1)
    current['scenes'][1]['durationSeconds'] = 10
    response = client.put(path + '/script', json=current)
    assert response.status_code == 422
    assert response.json()['detail']['code'] == 'script_duration_mismatch'


def test_scene_count_is_stored_and_backfilled(settings):
    with TestClient(create_app(settings)) as client:
        project = create_project(client)
        client.put(f"/api/projects/{project['id']}/script", json=script())
    database = Database(settings)
    try:
        config = Config(str(BACKEND_DIR / 'alembic.ini'))
        with database.migration_connection() as connection:
            assert connection.execute(text('SELECT scene_count FROM projects')).scalar_one() == 2
            config.attributes['connection'] = connection
            # Both directions rebuild `projects`; scenes must survive.
            command.downgrade(config, '0004_project_scripts')
            assert connection.execute(text('SELECT count(*) FROM project_scenes')).scalar_one() == 2
            command.upgrade(config, 'head')
            # Backfilled from project_scenes by migration 0005.
            assert connection.execute(text('SELECT scene_count FROM projects')).scalar_one() == 2
        with database.engine.connect() as connection:
            # Enforcement is back on for normal connections.
            assert connection.exec_driver_sql('PRAGMA foreign_keys').scalar_one() == 1
    finally:
        database.close()
