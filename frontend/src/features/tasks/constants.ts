export const TASK_FILTERS = [
  "all",
  "running",
  "queued",
  "attention",
  "succeeded",
  "cancelled",
] as const;

export const TASK_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export const TASK_QUERY_PARAMS = {
  STATUS: "status",
  PROJECT: "projectId",
  SELECTED: "task",
} as const;

export const TASK_PAGE_SIZE = 25;
export const TASK_POLL_INTERVAL_MS = 5_000;

export const TASK_ERROR_CODES = [
  "task_not_found",
  "task_finished",
  "task_not_retryable",
  "task_not_deletable",
  "confirm_required",
  "project_not_found",
  "script_conflict",
  "generation_active",
  "account_unavailable",
  "session_invalid",
  "proxy_error",
  "browser_unavailable",
  "browser_busy",
  "reply_timeout",
  "composer_unavailable",
  "workspace_not_running",
  "account_changed",
  "invalid_script",
  "interrupted",
  "internal_error",
  "unknown_kind",
  "dependency_failed",
  "account_deleted",
  "access_denied",
  "rate_limited",
  "network_error",
  "upstream_timeout",
  "upstream_error",
  "wake_failed",
  "generation_browser_error",
  "quota_exhausted",
  "generation_timeout",
  "message_not_delivered",
  "generation_refused",
  "media_download_failed",
  "scene_missing",
  "ffmpeg_unavailable",
  "merge_failed",
  "reference_upload_failed",
  "reference_frame_failed",
  "timeline_empty",
  "music_missing",
  "media_missing",
  "reference_missing",
  "image_count_mismatch",
  "conversation_unavailable",
  "too_many_files",
  "captions_unavailable",
] as const;

export const TASK_KINDS = [
  "plan_script",
  "render_scene",
  "merge_video",
  "generate_music",
  "generate_image",
  "generate_video",
] as const;

export const TASK_STATUS_CLASSES = {
  queued: "border-border text-muted-foreground",
  running: "border-primary/30 bg-primary/10 text-primary",
  succeeded: "border-success/30 bg-success-soft text-success",
  failed: "border-destructive/30 bg-destructive-soft text-destructive",
  cancelled: "border-border text-faint",
  interrupted: "border-destructive/30 bg-destructive-soft text-destructive",
} as const;
