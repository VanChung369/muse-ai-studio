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
        "The attached image is a frame from the previous shot of this film. Use it "
        "as a visual reference so the characters, wardrobe, props, lighting and "
        "color grade match it. Start from that exact frame only if this shot "
        "continues in the same place."
    ),
    "seamless": (
        "The attached image is the final frame of the previous shot. Begin this "
        "shot on exactly that frame and continue the action without a cut: same "
        "characters, wardrobe, location, lighting and color grade."
    ),
}
PREVIOUS_SHOT_LIMIT = 400


def build_scene_prompt(
    project: Project,
    scene: Scene,
    previous: Scene | None = None,
    has_reference: bool = False,
    in_thread: bool = False,
) -> str:
    """`previous` and `has_reference` are set when a frame of the previous
    scene is attached to the message (continuity is on and this is not the
    first scene)."""
    parts = [scene.prompt.strip()]
    if in_thread:
        # The earlier shots were made in this same conversation.
        parts.append(
            f"This is shot {scene.number} of the same film as the earlier shots in "
            "this conversation. Keep the characters, wardrobe, locations and style "
            "consistent with them."
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
    parts.append("Quality: " + QUALITY)
    return video_prompt("\n".join(parts), project.aspect_ratio, scene.duration_seconds)
