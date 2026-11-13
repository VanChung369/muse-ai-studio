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
