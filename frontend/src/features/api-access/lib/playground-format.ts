import { openAiErrorSchema } from "../schemas";
import type { ChatSegment, OpenAiErrorInfo } from "../types";

export function sanitizeResponseForJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeResponseForJson(item));
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
      if (
        key === "b64_json" &&
        typeof entry === "string" &&
        entry.length > 64
      ) {
        sanitized[key] = `<base64 image data, ${entry.length} chars omitted>`;
      } else {
        sanitized[key] = sanitizeResponseForJson(entry);
      }
    }
    return sanitized;
  }
  return value;
}

export function b64ToDataUrl(b64: string): string {
  if (b64.startsWith("data:")) return b64;
  let mime = "image/png";
  if (b64.startsWith("/9j/")) mime = "image/jpeg";
  else if (b64.startsWith("UklGR")) mime = "image/webp";
  else if (b64.startsWith("R0lGOD")) mime = "image/gif";
  return `data:${mime};base64,${b64}`;
}

export function parseOpenAiError(rawText: string): OpenAiErrorInfo | null {
  try {
    const parsedJson: unknown = JSON.parse(rawText);
    const result = openAiErrorSchema.safeParse(parsedJson);
    if (!result.success) return null;
    return {
      message: result.data.error.message,
      type: result.data.error.type,
      code: result.data.error.code ?? null,
    };
  } catch {
    return null;
  }
}

function isSafeMediaUrl(rawUrl: string): boolean {
  if (rawUrl.startsWith("/")) return !rawUrl.startsWith("//");
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const CHAT_MEDIA_RE = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;

export function parseChatMediaSegments(content: string): ChatSegment[] {
  const segments: ChatSegment[] = [];
  let lastIndex = 0;

  for (const match of content.matchAll(CHAT_MEDIA_RE)) {
    const index = match.index ?? 0;
    const [fullMatch, bang, label, rawUrl] = match;

    const isImage = bang === "!";
    const isVideo = bang === "" && label.trim().toLowerCase() === "video";

    if ((!isImage && !isVideo) || !isSafeMediaUrl(rawUrl)) {
      continue;
    }

    if (index > lastIndex) {
      segments.push({ type: "text", text: content.slice(lastIndex, index) });
    }

    if (isImage) {
      segments.push({ type: "image", alt: label, url: rawUrl });
    } else {
      segments.push({ type: "video", url: rawUrl });
    }

    lastIndex = index + fullMatch.length;
  }

  if (lastIndex < content.length) {
    segments.push({ type: "text", text: content.slice(lastIndex) });
  }

  return segments;
}

export function formatElapsedMs(ms: number): string {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const seconds = (tenths / 10).toFixed(1);
  return `${seconds}s`;
}

export function elapsedSince(startedAt: number): number {
  return performance.now() - startedAt;
}

export function currentTimestampMs(): number {
  return performance.now();
}

export function formatApiDate(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
