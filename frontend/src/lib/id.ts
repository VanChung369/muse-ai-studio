export function createId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  // getRandomValues also works when the app is served over local-network HTTP.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
