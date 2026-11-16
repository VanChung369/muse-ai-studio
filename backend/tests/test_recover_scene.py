"""A scene whose request reached Muse but whose clip the app never got (the
app stopped, or the clip was not seen in time) is taken back from the film's
conversation on retry instead of being generated again."""

import threading
import time

from fastapi.testclient import TestClient
from sqlalchemy import update

from app.integrations.muse.client import MuseError
from app.main import create_app
from app.models import Task
from test_render import (  # noqa: F401  (fixtures)
    add_account,
    add_project,
    client,
    ffmpeg,
    muse,
    render,
    settings,
    wait_status,
)


def stop_after_sending_scene_1(settings, muse):
    """Start a render and stop the app once scene 1 was sent."""
    muse.gate = threading.Event()
    app = create_app(settings)
    app.state.task_coordinator.poll_interval = 0.02
    with TestClient(app) as client:
        add_account(client)
        project = add_project(client)
        client.post(f"/api/projects/{project['id']}/render")
        assert muse.entered.wait(5)
    muse.killed.set()
    time.sleep(0.1)
    muse.killed.clear()
    muse.gate = None
    app = create_app(settings)
    app.state.task_coordinator.poll_interval = 0.02
    return app, project


def test_an_interrupted_scene_is_taken_back_without_asking(settings, muse, ffmpeg):
    muse.report_threads = True
    app, project = stop_after_sending_scene_1(settings, muse)
    # Muse made it while the app was down.
    muse.recoverable["shot-00000001"] = b"clip-made-meanwhile"
    with TestClient(app) as client:
        path = f"/api/projects/{project['id']}/render"
        assert render(client, project["id"])["scenes"][0]["task"]["status"] == "interrupted"
        # Its message is known, so nothing can be sent twice: no confirmation.
        resumed = client.post(path + "/resume")
        assert resumed.status_code == 200, resumed.text
        done = wait_status(client, project["id"], "completed")
        assert muse.recovered == [("/thread/t-1", "shot-00000001")]
        assert client.get(done["scenes"][0]["videoUrl"]).content == b"clip-made-meanwhile"
    # Scene 1 was generated once; scene 2 followed.
    assert len(muse.prompts) == 2


def test_an_interrupted_scene_without_a_known_message_still_asks(settings, muse, ffmpeg):
    # Sent by an app that did not keep the marker (or never learned the thread).
    app, project = stop_after_sending_scene_1(settings, muse)
    with TestClient(app) as client:
        with client.app.state.database.engine.begin() as connection:
            connection.execute(update(Task).values(checkpoint_json="{}"))
        refused = client.post(f"/api/projects/{project['id']}/render/resume")
        assert refused.status_code == 409
        assert refused.json()["detail"]["code"] == "confirm_required"


def test_a_timed_out_scene_is_taken_back_on_resume(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[1] = MuseError("generation_timeout", 504)
    client.post(path)
    wait_status(client, project["id"], "failed")
    muse.recoverable["shot-00000001"] = b"clip-seen-late"
    assert client.post(path + "/resume").status_code == 200
    done = wait_status(client, project["id"], "completed")
    assert muse.recovered == [("/thread/t-1", "shot-00000001")]
    assert client.get(done["scenes"][0]["videoUrl"]).content == b"clip-seen-late"
    assert len(muse.prompts) == 2


def test_a_message_that_never_arrived_is_sent_again(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[1] = MuseError("generation_timeout", 504)
    client.post(path)
    wait_status(client, project["id"], "failed")
    # Nothing in the conversation answers it: a new request is sent.
    client.post(path + "/resume")
    done = wait_status(client, project["id"], "completed")
    assert muse.recovered == [("/thread/t-1", "shot-00000001")]
    assert len(muse.prompts) == 3
    assert client.get(done["scenes"][0]["videoUrl"]).content == b"clip-2"


def test_a_refused_scene_is_asked_for_again(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[1] = MuseError("generation_refused")
    client.post(path)
    wait_status(client, project["id"], "failed")
    client.post(path + "/resume")
    wait_status(client, project["id"], "completed")
    # Muse answered without a clip: nothing to take back.
    assert muse.recovered == []
    assert len(muse.prompts) == 3


def test_render_again_never_takes_an_old_take_back(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    client.post(path)
    wait_status(client, project["id"], "completed")
    muse.recoverable["shot-00000001"] = b"old-take"
    assert client.post(path + "/restart", json={"fromScene": 1}).status_code == 200
    wait_status(client, project["id"], "completed")
    assert muse.recovered == []
    assert len(muse.prompts) == 4


def test_render_again_after_a_timeout_asks_for_a_new_take(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[1] = MuseError("generation_timeout", 504)
    client.post(path)
    wait_status(client, project["id"], "failed")
    # Muse did make it, but the user asks for scene 1 again from scratch.
    muse.recoverable["shot-00000001"] = b"the-take-that-timed-out"
    assert client.post(path + "/restart", json={"fromScene": 1}).status_code == 200
    done = wait_status(client, project["id"], "completed")
    assert muse.recovered == []
    assert client.get(done["scenes"][0]["videoUrl"]).content == b"clip-2"


def test_a_conversation_that_does_not_open_keeps_the_message_for_later(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[1] = MuseError("generation_timeout", 504)
    client.post(path)
    wait_status(client, project["id"], "failed")
    # It could not be looked at: nothing is sent again, it stays to look for.
    muse.recoverable["shot-00000001"] = MuseError("conversation_unavailable")
    client.post(path + "/resume")
    failed = wait_status(client, project["id"], "failed")
    assert failed["scenes"][0]["task"]["error"]["code"] == "conversation_unavailable"
    assert len(muse.prompts) == 1
    muse.recoverable["shot-00000001"] = b"found-next-time"
    client.post(path + "/resume")
    done = wait_status(client, project["id"], "completed")
    assert client.get(done["scenes"][0]["videoUrl"]).content == b"found-next-time"
    assert len(muse.prompts) == 2


def test_a_message_on_another_account_is_not_sent_again(client, muse, ffmpeg):
    muse.report_threads = True
    add_account(client)
    project = add_project(client)
    path = f"/api/projects/{project['id']}/render"
    muse.failures[1] = MuseError("generation_timeout", 504)
    client.post(path)
    wait_status(client, project["id"], "failed")
    with client.app.state.database.engine.begin() as connection:
        connection.execute(
            update(Task)
            .where(Task.scene_number == 1)
            .values(
                checkpoint_json='{"sent": {"marker": "shot-00000001", '
                '"thread": "/thread/t-1", "account": "another-account"}}'
            )
        )
    client.post(path + "/resume")
    failed = wait_status(client, project["id"], "failed")
    assert failed["scenes"][0]["task"]["error"]["code"] == "conversation_unavailable"
    assert muse.recovered == [] and len(muse.prompts) == 1


def test_a_refreshed_session_is_the_one_used_next(client, muse):
    from types import SimpleNamespace

    from app.accounts.task_session import TaskAccountSession

    account = add_account(client)
    session = TaskAccountSession(client.app, account["id"])
    session.persist(
        SimpleNamespace(cookies={"hatch_sess": "rotated"}, expiries={}, verified=True)
    )
    assert session.cookies["hatch_sess"] == "rotated"
