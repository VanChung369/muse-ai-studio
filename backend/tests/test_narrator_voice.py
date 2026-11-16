"""One narrator voice for the whole film: the script describes it once and
every scene prompt carries that description word for word, because each
scene is generated on its own."""

from types import SimpleNamespace

from app.planning.script import build_script_prompt
from app.rendering.prompt import NARRATOR_LABEL, build_scene_prompt, narrator_voice

VOICE = "adult man, deep warm baritone, Hanoi accent, calm unhurried pace"


def film(**changes):
    values = dict(
        scene_count=6,
        visual_style="Rainy neon night.",
        character_bible="Main character: Linh, yellow raincoat.\n"
        f"{NARRATOR_LABEL} {VOICE}.",
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


def test_every_scene_carries_the_same_narrator_voice():
    prompts = [build_scene_prompt(film(), scene(number)) for number in (1, 4, 6)]
    line = next(part for part in prompts[0].split("\n") if part.startswith("Narrator voice:"))
    assert VOICE in line and "Never switch to another voice." in line
    assert all(line in prompt.split("\n") for prompt in prompts)


def test_without_a_described_voice_the_prompt_still_asks_for_one_narrator():
    prompt = build_scene_prompt(film(character_bible="Linh, yellow raincoat."), scene(2))
    assert "Narrator voice: one narrator for the whole film." in prompt


def test_no_narrator_line_without_narration_or_sound():
    assert "Narrator voice" not in build_scene_prompt(film(), scene(1, narration=""))
    assert "Narrator voice" not in build_scene_prompt(film(mute=True), scene(1))


def test_narrator_voice_is_read_from_the_character_bible():
    assert narrator_voice(f"Linh.\n{NARRATOR_LABEL} {VOICE}.\nMinh.") == VOICE + "."
    assert narrator_voice("Narrator: soft female voice") == "soft female voice"
    assert narrator_voice("Linh, no narrator here.") == ""
    # Not a narrator's label: the description is not taken from other prose.
    assert narrator_voice("No narrator. Main character: Linh, yellow coat.") == ""
    assert narrator_voice(f"Main character: Linh.\nNarrator voice: {VOICE}") == VOICE


def test_the_script_is_asked_to_describe_the_narrator_once():
    brief = {"durationSeconds": 60, "language": "vi", "narration": True}
    assert NARRATOR_LABEL in build_script_prompt(brief)
    # Also without the option: an idea can call for narration (seen
    # 2026-11-16, a film narrated with the option off).
    assert NARRATOR_LABEL in build_script_prompt({**brief, "narration": False})
    assert NARRATOR_LABEL not in build_script_prompt({**brief, "mute": True})
