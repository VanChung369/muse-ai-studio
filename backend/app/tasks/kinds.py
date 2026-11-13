"""Task kinds and status groups shared by the coordinator, handlers, and
repositories (kept here to avoid import cycles)."""

PLAN_SCRIPT = "plan_script"

ACTIVE_STATUSES = ("queued", "running")
