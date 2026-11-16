"""Scene prompts written so separately generated shots join up: how a shot
opens after the previous one, no slow start or held frame at either end,
steady sound to the edges, narration clear of the joins (muse.ai clips on
2026-11-16 eased in, held a still frame for up to 1.9 s and faded their
sound in over up to 0.7 s)."""

from types import SimpleNamespace

from app.planning.script import build_script_prompt
from app.rendering.prompt import build_scene_prompt


def film(**changes):
    values = dict(
        scene_count=6,
        visual_style="",
        character_bible="",
        look="auto",
        continuity="reference",
        language="vi",
        mute=False,
        music="",
        aspect_ratio="16:9",
    )
    return SimpleNamespace(**{**values, **changes})


def scene(number, narration="Sài Gòn, năm 2090."):
    return SimpleNamespace(
        number=number, prompt="A wide shot.", narration=narration, duration_seconds=10
    )


def lines(prompt):
    return {line.split(":", 1)[0]: line for line in prompt.split("\n") if ":" in line}


def test_every_shot_keeps_moving_and_sounding_to_its_edges():
    prompt = lines(build_scene_prompt(film(), scene(3), previous=scene(2), has_reference=True))
    assert "no slow start" in prompt["Flow"] and "held still frame" in prompt["Flow"]
    assert "no fade-in, fade-out or silence" in prompt["Sound"]
    assert "half a second before the end" in prompt["Voice-over, spoken by a narrator in Vietnamese"]


def test_a_silent_film_is_not_asked_for_sound():
    prompt = build_scene_prompt(film(mute=True), scene(2))
    assert "Flow: " in prompt and "Sound: " not in prompt


def test_the_next_shot_either_continues_the_frame_or_cuts_cleanly():
    continuity = lines(
        build_scene_prompt(film(), scene(4), previous=scene(3), has_reference=True)
    )["Continuity"]
    assert "begin on exactly that frame" in continuity
    assert "never open on a copy or variation of the attached frame" in continuity
    assert "carry over the state things were left in" in continuity


def test_the_script_says_how_each_shot_opens():
    prompt = build_script_prompt({"durationSeconds": 60, "language": "vi"})
    assert "'Continuing in the same place:'" in prompt and "'New place:'" in prompt
