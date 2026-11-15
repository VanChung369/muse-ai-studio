"""What Muse is asked for each scene.

Every scene is generated on its own and the generator remembers nothing, so
the prompt carries everything that must stay the same across the film: the
shared visual style and characters, the chosen look, and how the shot relates
to the one before it.
"""

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

# How the attached frame of the previous shot is to be used.
CONTINUITY = {
    "reference": (
        "The attached image previous-shot.jpg is a frame from the previous shot of this film. Use it "
        "as a visual reference so the characters, wardrobe, props, lighting and "
        "color grade match it. Start from that exact frame only if this shot "
        "continues in the same place."
    ),
    "seamless": (
        "The attached image previous-shot.jpg is the final frame of the previous shot. Begin this "
        "shot on exactly that frame and continue the action without a cut: same "
        "characters, wardrobe, location, lighting and color grade."
    ),
}
PREVIOUS_SHOT_LIMIT = 400

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
            f'Voice-over, spoken by a narrator{spoken}: "{scene.narration.strip()}"'
        )
    if project.music.strip() and not project.mute:
        parts.append("Music: " + project.music.strip())
    if language and not project.mute:
        parts.append(
            f"Language: any speech, voice-over or singing is in {language} only."
        )
    parts.append("Quality: " + QUALITY)
    return video_prompt("\n".join(parts), project.aspect_ratio, scene.duration_seconds)
