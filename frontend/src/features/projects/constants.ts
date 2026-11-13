export const PROJECT_STATUSES = [
  "draft",
  "planning",
  "ready",
  "rendering",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
] as const;

export const PROJECT_FILTERS = [
  "all",
  "inProgress",
  "completed",
  "cancelled",
] as const;
export const PROJECT_SORTS = ["updated", "name", "duration"] as const;
export const PROJECT_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;
// The film's visual look; "auto" leaves it to the script's visual style.
export const PROJECT_LOOKS = [
  "auto",
  "realistic",
  "cinematic",
  "documentary",
  "commercial",
  "animation3d",
  "anime",
] as const;
// Language of titles, narration and speech; "auto" follows the idea.
export const PROJECT_LANGUAGES = [
  "auto",
  "vi",
  "en",
  "zh",
  "ja",
  "ko",
  "es",
  "fr",
  "de",
  "pt",
  "th",
  "id",
] as const;
// How a scene uses the last frame of the one before it.
export const PROJECT_CONTINUITIES = ["reference", "seamless", "off"] as const;
// Reference material: what the server accepts (see references.py).
export const REFERENCE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime";
export const REFERENCE_MAX_FILES = 6;
export const REFERENCE_MAX_BYTES = 50 * 1024 * 1024;
export const REFERENCE_ERROR_CODES = [
  "unsupported_file",
  "file_too_large",
  "too_many_files",
  "empty_file",
  "project_busy",
  "project_not_found",
] as const;
export const PROJECT_UPDATE_ERROR_CODES = [
  "project_busy",
  "project_locked",
  "duration_locked",
  "project_not_found",
] as const;
export const PROJECT_COVER_TONES = [
  "coffee",
  "night",
  "tea",
  "studio",
  "space",
  "landscape",
] as const;
export const PROJECT_ERROR_CODES = [
  "sessionExpired",
  "quotaExhausted",
  "proxyError",
  "unknown",
] as const;

// While a render runs (design board 42: poll every 3 s).
export const RENDER_POLL_INTERVAL_MS = 3_000;
export const RENDER_ERROR_CODES = [
  "render_not_ready",
  "account_unavailable",
  "render_not_active",
  "render_not_resumable",
  "confirm_required",
  "render_not_restartable",
  "project_not_found",
] as const;

export const TIMELINE_ERROR_CODES = [
  "timeline_locked",
  "ffmpeg_unavailable",
  "invalid_timeline",
  "project_not_found",
] as const;

// Projects per request; matches the backend default.
export const PROJECT_PAGE_SIZE = 24;

export const PROJECT_QUERY_KEYS = {
  SEARCH: "q",
  FILTER: "status",
  SORT: "sort",
  SELECTED: "project",
} as const;

export const PROJECT_COVER_CLASSES = {
  coffee:
    "bg-[radial-gradient(ellipse_at_65%_30%,#505452_0%,#354750_50%,#20272b_100%)]",
  night: "bg-[linear-gradient(145deg,#283e51_0%,#344452_45%,#171e29_100%)]",
  tea: "bg-[radial-gradient(ellipse_at_45%_25%,#4c5645_0%,#293c2b_60%,#14211a_100%)]",
  studio: "bg-[linear-gradient(145deg,#6b573c_0%,#4a3c26_45%,#282318_100%)]",
  space:
    "bg-[radial-gradient(ellipse_at_60%_30%,#69505b_0%,#3d3447_55%,#24212d_100%)]",
  landscape: "bg-[linear-gradient(145deg,#625242_0%,#3f4734_50%,#222d26_100%)]",
} as const;

export const GENERATION_ERROR_CODES = [
  "account_unavailable",
  "generation_active",
  "script_conflict",
  "invalid_script",
  "session_invalid",
  "proxy_error",
  "browser_unavailable",
  "browser_busy",
  "reply_timeout",
  "composer_unavailable",
  "workspace_not_running",
  "account_changed",
] as const;
