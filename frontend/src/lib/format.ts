export function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Pass `now` from `useNow()` so the label refreshes while the page is open.
 * Timestamps up to a minute old (or slightly in the future) read as "now".
 */
export function formatRelativeTime(
  timestamp: string,
  language: string,
  now: number,
): string {
  const seconds = Math.min(0, (Date.parse(timestamp) - now) / 1000);
  const absolute = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: "auto" });

  if (absolute < 60) return formatter.format(0, "second");
  if (absolute < 3600)
    return formatter.format(Math.round(seconds / 60), "minute");
  if (absolute < 86400)
    return formatter.format(Math.round(seconds / 3600), "hour");
  if (absolute < 604800)
    return formatter.format(Math.round(seconds / 86400), "day");
  return new Intl.DateTimeFormat(language, { dateStyle: "medium" }).format(
    new Date(timestamp),
  );
}
