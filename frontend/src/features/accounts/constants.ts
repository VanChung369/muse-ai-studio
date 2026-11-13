export const ACCOUNT_FILTERS = ["all", "enabled", "disabled"] as const;
export const ACCOUNT_QUERY_KEYS = { SEARCH: "q", FILTER: "status" } as const;
export const ACCOUNT_POLL_INTERVAL_MS = 30_000;
// Table columns (design/source/src/Accounts.dc.html).
export const ACCOUNT_COLUMNS = [
  "account",
  "status",
  "quota",
  "session",
  "proxy",
  "running",
  "actions",
] as const;

export const ACCOUNT_STATUSES = [
  "ready",
  "lowQuota",
  "expired",
  "proxyError",
  "paused",
  "unverified",
] as const;

// Below this share of weekly quota left, the account is flagged as running low.
export const LOW_QUOTA_PCT = 10;

export const ACCOUNT_OPERATION_CODES = [
  "session_valid",
  "keepalive_complete",
  "quota_updated",
  "session_invalid",
  "workspace_not_running",
  "wake_failed",
  "upstream_timeout",
  "network_error",
  "proxy_error",
  "access_denied",
  "rate_limited",
  "upstream_error",
  "invalid_response",
  "workspace_unavailable",
  "quota_unavailable",
  "browser_unavailable",
  "browser_busy",
  "account_busy",
  "account_changed",
] as const;

// Matches the backend limit: enough for a full browser cookie export. The
// server skips everything that is not a usable muse.ai cookie.
export const MAX_COOKIE_TEXT = 1_048_576;
