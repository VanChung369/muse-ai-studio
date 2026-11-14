"""Task kinds and status groups shared by the coordinator, handlers, and
repositories (kept here to avoid import cycles)."""

PLAN_SCRIPT = "plan_script"
RENDER_SCENE = "render_scene"
MERGE_VIDEO = "merge_video"
# A piece of background music for a project, made by Muse.
GENERATE_MUSIC = "generate_music"
GENERATE_IMAGE = "generate_image"
GENERATE_VIDEO = "generate_video"
QUICK_KINDS = (GENERATE_IMAGE, GENERATE_VIDEO)
# One chain per project: every scene in order, then the merge.
RENDER_KINDS = (RENDER_SCENE, MERGE_VIDEO)

ACTIVE_STATUSES = ("queued", "running")
FINISHED_STATUSES = ("succeeded", "failed", "cancelled", "interrupted")


def is_deletable(kind: str, status: str, project_id: str | None) -> bool:
    """Whether a task may be removed from the list: it has finished, and it
    is not part of a film that still exists. A film's render tasks are its
    record (they are queued again to re-render or re-merge it), so they
    go only when the project does."""
    return status in FINISHED_STATUSES and not (
        kind in RENDER_KINDS and project_id is not None
    )
