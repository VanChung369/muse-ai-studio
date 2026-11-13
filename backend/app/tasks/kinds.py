"""Task kinds and status groups shared by the coordinator, handlers, and
repositories (kept here to avoid import cycles)."""

PLAN_SCRIPT = "plan_script"
RENDER_SCENE = "render_scene"
MERGE_VIDEO = "merge_video"
# One chain per project: every scene in order, then the merge.
RENDER_KINDS = (RENDER_SCENE, MERGE_VIDEO)

ACTIVE_STATUSES = ("queued", "running")
