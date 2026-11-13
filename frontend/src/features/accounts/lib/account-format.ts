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
