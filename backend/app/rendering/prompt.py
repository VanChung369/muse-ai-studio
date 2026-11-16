"""What Muse is asked for each scene.

Every scene is generated on its own and the generator remembers nothing, so
the prompt carries everything that must stay the same across the film: the
shared visual style and characters, the chosen look, and how the shot relates
to the one before it.
"""

import re

from app.integrations.muse.media import video_prompt
from app.models import Project, Scene

# The look the user picks for the whole film. `auto` adds nothing and leaves
# the look to the script's own visual style.
LOOKS = {
    "auto": "",
    "realistic": (
        "Photorealistic live-action footage shot on a professional cinema camera. "
        "Real people in real locations, natural skin texture, realistic materials, "
        "physically plausible motion, natural light with soft shadows, shallow depth "
        "of field and subtle film grain. Not animated, not CGI, no waxy or plastic "
        "skin, no cartoon look."
    ),
    "cinematic": (
        "Cinematic feature-film look: anamorphic lens, motivated lighting, rich "
        "contrast, a deliberate color grade, shallow depth of field and smooth, "
        "purposeful camera movement."
    ),
    "documentary": (
        "Documentary look: handheld camera with slight natural shake, available "
        "light, candid unposed moments and true-to-life colors."
    ),
    "commercial": (
        "High-end commercial look: clean studio-quality lighting, crisp detail, "
        "smooth motion-controlled camera moves and a polished color grade."
    ),
    "animation3d": (
        "High-quality 3D animated film look: appealing stylized characters with "
        "expressive faces, soft global illumination and richly detailed textures."
    ),
    "anime": (
        "Japanese anime look: clean line art, cel shading, expressive characters "
        "and detailed painted backgrounds."
    ),
}

# Asked of every scene, whatever the look: the usual tells of generated video.
QUALITY = (
    "Keep faces, hands and bodies anatomically correct and stable for the whole "
    "shot. Motion is smooth and natural. No on-screen text, captions, logos or "
    "watermarks. No flicker, morphing or warping."
)
# Asked of every scene: the film is cut together from separate shots, and a
# shot that eases in or settles into a still frame makes every join stall
# (measured on muse.ai clips, 2026-11-16: up to 1.9 s still at the end).
FLOW = (
    "The action and the camera are already moving on the first frame and still "
    "moving on the last: no slow start, and no slowing down, settling or held "
    "still frame at the end."
)
# Their sound faded in over up to 0.7 s and dropped out at the joins.
STEADY_SOUND = (
    "Ambient sound and music play at a steady level from the first frame to the "
    "last: no fade-in, fade-out or silence at the start or the end."
)
# Kept clear of the joins, where shots overlap when dissolved.
NARRATION_TIMING = (
    "Start the voice-over after the first half second and finish it half a "
    "second before the end."
)

# How the attached frame of the previous shot is to be used.
CONTINUITY = {
    "reference": (
        "The attached image previous-shot.jpg is the last frame of the previous shot of this film. "
        "Match its characters, wardrobe, props, lighting and color grade, and carry over "
        "the state things were left in (what each character holds, what is open or lit). "
        "If this shot continues in the same place, begin on exactly that frame and carry "
        "the action on without a jump. If it is in a different place, open directly on "
        "this shot's own setting and action, a clean cut: never open on a copy or "
        "variation of the attached frame."
    ),
    "seamless": (
        "The attached image previous-shot.jpg is the final frame of the previous shot. Begin this "
        "shot on exactly that frame and continue the action without a cut: same "
        "characters, wardrobe, location, lighting and color grade."
    ),
}
PREVIOUS_SHOT_LIMIT = 400

# How the script names the narrator's voice in the character bible.
NARRATOR_LABEL = "Narrator (voice only):"
# "Narrator:", "Narrator (voice only):" or "Narrator voice:", nothing looser:
# "No narrator. Main character: ..." is not a narrator's description.
_NARRATOR = re.compile(
    r"\bnarrator\b(?:\s*\([^)\n]{0,40}\)|(?:[ \t]+\w+){0,2})[ \t]*:[ \t]*([^\n]+)",
    re.IGNORECASE,
)
ONE_NARRATOR = (
    "Use exactly this one narrator voice in every shot of this film, the same "
    "as in its earlier shots: same person, gender, age, pitch, timbre, accent "
    "and pace. Never switch to another voice."
)


def narrator_voice(character_bible: str) -> str:
    """The narrator's voice as the character bible describes it
    ("Narrator (voice only): adult woman, warm low voice, ..."), or ''."""
    match = _NARRATOR.search(character_bible or "")
    return match.group(1).strip() if match else ""


LANGUAGES = {
    "vi": "Vietnamese",
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "es": "Spanish",
    "fr": "French",
    "de": "German",
    "pt": "Portuguese",
    "th": "Thai",
    "id": "Indonesian",
}


def build_scene_prompt(
    project: Project,
    scene: Scene,
    previous: Scene | None = None,
    has_reference: bool = False,
    in_thread: bool = False,
    materials: bool = False,
    new_materials: bool = False,
    kept_materials: bool = False,
    dropped: tuple[str, ...] | list[str] = (),
    summary: str = "",
) -> str:
    """The message for one scene (see app/rendering/conversation.py).

    `previous` and `has_reference` are set when a frame of the previous
    scene is attached (continuity is on and this is not the first scene).
    `in_thread`: the film's conversation carries on. `materials`: every
    reference file is attached (a new conversation). `new_materials`: files
    added since the conversation last saw them are attached. `dropped`:
    names of files the conversation saw that the film no longer uses.
    `summary`: what an earlier conversation about the film settled, for the
    first message of a new one.
    """
    parts = [scene.prompt.strip()]
    total = max(project.scene_count, scene.number)
    if in_thread:
        # The film's earlier messages are in this conversation. A shot is
        # also asked for again there (a retry, or "render again from here"),
        # and the agent must not answer with the take it already made.
        parts.append(
            f"Context: shot {scene.number} of {total} of the film this conversation "
            "is about. Keep the characters, wardrobe, locations and style consistent "
            + (
                "with its earlier shots and reference files. "
                if scene.number > 1
                else "with what was established for this film earlier in this conversation. "
            )
            + "Make a new video for this shot now, even if this shot was made earlier "
            "in this conversation: do not reuse, re-send or link an earlier clip."
        )
    elif summary:
        parts.append(
            f"Context: shot {scene.number} of {total} of a film begun in an earlier "
            "conversation. What was settled there, to follow here:\n" + summary
        )
    else:
        parts.append(f"Context: shot {scene.number} of {total} of a film.")
    if materials:
        parts.append(
            "Reference material: the attached files show this film's characters, "
            "products, locations or look. Match them in every shot."
        )
    elif new_materials:
        parts.append(
            "New reference material: the attached files were added to this film's "
            "references. Match them from this shot on"
            + (
                ", together with the reference files sent earlier in this conversation."
                if kept_materials
                else "."
            )
        )
    if dropped:
        parts.append(
            "Reference files no longer used: "
            + ", ".join(dropped)
            + ". They were sent earlier in this conversation; do not follow them any more."
        )
    if project.visual_style.strip():
        parts.append("Visual style: " + project.visual_style.strip())
    if project.character_bible.strip():
        parts.append("Recurring characters: " + project.character_bible.strip())
    if LOOKS.get(project.look):
        parts.append("Look: " + LOOKS[project.look])
    if has_reference and project.continuity in CONTINUITY:
        parts.append("Continuity: " + CONTINUITY[project.continuity])
        if previous is not None:
            summary = " ".join(previous.prompt.split())[:PREVIOUS_SHOT_LIMIT]
            parts.append("Previous shot: " + summary)
    language = LANGUAGES.get(project.language)
    if project.mute:
        # A silent film: nothing is spoken, so narration and language do not apply.
        parts.append(
            "Audio: this is a silent video. No dialogue, voice-over, music or "
            "sound effects."
        )
    elif scene.narration.strip():
        # The line a narrator speaks over this shot.
        spoken = f" in {language}" if language else ""
        parts.append(
            f'Voice-over, spoken by a narrator{spoken}: "{scene.narration.strip()}" '
            + NARRATION_TIMING
        )
        # The same words in every shot: each is generated on its own.
        voice = narrator_voice(project.character_bible)
        parts.append(
            f"Narrator voice: {voice.rstrip('.')}. {ONE_NARRATOR}"
            if voice
            else "Narrator voice: one narrator for the whole film. " + ONE_NARRATOR
        )
    if project.music.strip() and not project.mute:
        parts.append("Music: " + project.music.strip())
    if language and not project.mute:
        parts.append(
            f"Language: any speech, voice-over or singing is in {language} only."
        )
    parts.append("Flow: " + FLOW)
    if not project.mute:
        parts.append("Sound: " + STEADY_SOUND)
    parts.append("Quality: " + QUALITY)
    return video_prompt("\n".join(parts), project.aspect_ratio, scene.duration_seconds)
