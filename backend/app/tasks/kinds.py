"""Task kinds and status groups shared by the coordinator, handlers, and
repositories (kept here to avoid import cycles)."""

PLAN_SCRIPT = "plan_script"
RENDER_SCENE = "render_scene"
MERGE_VIDEO = "merge_video"
# A piece of background music for a project, made by Muse.
GENERATE_MUSIC = "generate_music"
# One chain per project: every scene in order, then the merge.
RENDER_KINDS = (RENDER_SCENE, MERGE_VIDEO)

ACTIVE_STATUSES = ("queued", "running")
