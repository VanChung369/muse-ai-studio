"""A new film starts with its scenes joined by a short dissolve and their
sound levelled (the user's choice, 2026-11-16); a film rendered before keeps
straight cuts."""

from app.rendering.ffmpeg import Clip
from test_render import add_account, add_project, client, muse, settings, wait_status  # noqa: F401


def test_a_new_film_starts_with_dissolves_and_levelled_sound(client, muse, monkeypatch):
    built = []

    def compose(binary, segments, output, check_cancelled, **options):
        built.append(options)
        output.write_bytes(b"film")

    monkeypatch.setattr("app.rendering.tasks.find_ffmpeg", lambda settings: "ffmpeg")
    monkeypatch.setattr("app.rendering.film.compose", compose)
    monkeypatch.setattr(
        "app.rendering.film.probe", lambda binary, path: Clip(path, 10.0, 1280, 720, True)
    )
    levelled = []

    def level_gains(binary, segments, cancelled):
        levelled.append(len(segments))
        return [1.0] * len(segments)

    monkeypatch.setattr("app.rendering.film.level_gains", level_gains)
    monkeypatch.setattr(
        "app.rendering.tasks.last_frame", lambda binary, clip: b"frame-of-" + clip.read_bytes()
    )
    add_account(client)
    project = add_project(client)
    client.post(f"/api/projects/{project['id']}/render")
    wait_status(client, project["id"], "completed")
    output = client.get(f"/api/projects/{project['id']}/timeline").json()["output"]
    assert (output["transition"], output["level"]) == (0.3, True)
    # The merge used them.
    assert built and built[-1]["transition"] == 0.3
    assert levelled == [2]  # Both scenes measured for levelling.
