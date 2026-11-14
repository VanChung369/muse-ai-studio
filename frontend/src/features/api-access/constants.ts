export const MAX_API_KEYS = 20;
export const API_KEY_NAME_MAX_LENGTH = 60;
export const MAX_PROMPT_LENGTH = 4000;
export const VIDEO_POLL_INTERVAL_MS = 3000;

export const API_KEY_COLUMNS = [
  "name",
  "masked",
  "created",
  "lastUsed",
  "actions",
] as const;

export const QUICKSTART_LANGUAGES = ["curl", "python", "node"] as const;

export const V1_BASE_PATH = "/v1";

export const V1_ENDPOINTS = {
  MODELS: "/v1/models",
  IMAGES: "/v1/images/generations",
  VIDEOS: "/v1/videos/generations",
  CHAT: "/v1/chat/completions",
} as const;

export const PLAYGROUND_ENDPOINTS = [
  "images",
  "videos",
  "chat",
  "models",
] as const;

export const IMAGE_SHAPES = [
  { id: "square", ratio: "1:1", size: "1024x1024" },
  { id: "landscape", ratio: "16:9", size: "1792x1024" },
  { id: "portrait", ratio: "9:16", size: "1024x1792" },
] as const;

export const IMAGE_COUNTS = [1, 2, 3, 4] as const;

export const IMAGE_RESPONSE_FORMATS = ["url", "b64_json"] as const;

export const VIDEO_ASPECT_RATIOS = [
  { id: "landscape", ratio: "16:9" },
  { id: "portrait", ratio: "9:16" },
  { id: "square", ratio: "1:1" },
] as const;

export const CHAT_MODELS = ["muse-image", "muse-video"] as const;

export const DOCS_SECTIONS = [
  { id: "base-url", key: "baseUrl" },
  { id: "authentication", key: "auth" },
  { id: "waiting", key: "waiting" },
  { id: "models", key: "models" },
  { id: "endpoints", key: "endpoints" },
  { id: "errors", key: "errors" },
  { id: "notes", key: "notes" },
] as const;

export const DOCS_ERROR_ROWS = [
  { http: 401, type: "invalid_request_error", code: "invalid_api_key" },
  { http: 400, type: "invalid_request_error", code: "invalid_request" },
  {
    http: 400,
    type: "invalid_request_error",
    code: "content_policy_violation",
  },
  { http: 404, type: "invalid_request_error", code: "not_found" },
  { http: 409, type: "invalid_request_error", code: "library_full" },
  { http: 429, type: "rate_limit_error", code: "rate_limit_exceeded" },
  { http: 502, type: "api_error", code: "upstream_error" },
  { http: 503, type: "api_error", code: "no_account_available" },
  { http: 504, type: "api_error", code: "timeout" },
] as const;
