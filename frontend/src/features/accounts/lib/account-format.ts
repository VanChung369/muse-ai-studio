import { LOW_QUOTA_PCT } from "../constants";
import type { Account, AccountStatus } from "../types";

export function formatAccountDate(
  value: string | null,
  language: string,
  fallback: string,
) {
  return value
    ? new Intl.DateTimeFormat(language, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : fallback;
}

/** Share of an allowance still available, 0–100. */
export function remainingPct(usedPct: number) {
  return Math.round(100 - usedPct);
}

// One badge per account; the first matching problem wins.
export function accountStatus(account: Account, now: number): AccountStatus {
  if (!account.enabled) return "paused";
  if (
    account.sessionStatus === "invalid" ||
    (account.expiresAt !== null && Date.parse(account.expiresAt) <= now)
  )
    return "expired";
  if (account.lastError === "proxy_error") return "proxyError";
  if (
    account.quota &&
    remainingPct(account.quota.weeklyUsedPct) < LOW_QUOTA_PCT
  )
    return "lowQuota";
  return account.sessionStatus === "valid" ? "ready" : "unverified";
}

/** "6 days", "3 hours", "12 minutes": the largest whole unit, at least 1 minute. */
export function formatTimeLeft(milliseconds: number, language: string) {
  const minutes = Math.max(1, Math.floor(milliseconds / 60_000));
  let value = minutes;
  let unit = "minute";
  if (minutes >= 1440) {
    value = Math.floor(minutes / 1440);
    unit = "day";
  } else if (minutes >= 60) {
    value = Math.floor(minutes / 60);
    unit = "hour";
  }
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit,
    unitDisplay: "long",
  }).format(value);
}
