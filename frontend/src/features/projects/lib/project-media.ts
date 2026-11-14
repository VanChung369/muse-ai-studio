import { ApiError } from "@/lib/http";

export const MEDIA_MAX_FILES = 30;
export const MEDIA_MAX_BYTES = 200 * 1024 * 1024;

export const MEDIA_TYPES = [
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "image/png",
  "image/jpeg",
  "image/webp",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/mp4",
  // What Chrome calls an .m4a file.
  "audio/x-m4a",
  "audio/aac",
  "audio/ogg",
] as const;

// Include extensions for formats whose MIME type browsers sometimes leave empty.
export const MEDIA_ACCEPT = [...MEDIA_TYPES, ".mov", ".m4a", ".mp3"].join(",");

export const MEDIA_ERROR_CODES = [
  "unsupported_file",
  "file_too_large",
  "too_many_files",
  "project_busy",
  "ffmpeg_unavailable",
  "empty_file",
  "unreadable_file",
  "media_in_use",
  "project_not_found",
] as const;

export type MediaErrorCode = (typeof MEDIA_ERROR_CODES)[number];
export type MediaErrorKey =
  | `projects.media.errors.${MediaErrorCode}`
  | "projects.media.errors.unknown";

export type MediaValidationErrorCode =
  | "unsupported_file"
  | "file_too_large"
  | "too_many_files"
  | "empty_file";

const ACCEPTED_TYPES = new Set<string>(MEDIA_TYPES);

const EXTENSION_MIME: Record<string, string> = {
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
};

/** Resolve the MIME type to send in Content-Type, falling back to extension. */
export function mediaMime(file: File): string {
  if (file.type) return file.type;
  const dot = file.name.lastIndexOf(".");
  if (dot < 0) return "";
  return EXTENSION_MIME[file.name.slice(dot + 1).toLowerCase()] ?? "";
}

export function mediaErrorKey(error: unknown): MediaErrorKey {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = MEDIA_ERROR_CODES.find((value) => value === code);
  return known
    ? (`projects.media.errors.${known}` as const)
    : "projects.media.errors.unknown";
}

export function validateMediaFiles(
  files: FileList | File[],
  existingCount: number,
  maxFiles = MEDIA_MAX_FILES,
): { accepted: File[]; errorCode: MediaValidationErrorCode | null } {
  const accepted: File[] = [];
  let errorCode: MediaValidationErrorCode | null = null;

  for (const file of files) {
    if (!ACCEPTED_TYPES.has(mediaMime(file))) {
      errorCode ??= "unsupported_file";
      continue;
    }
    if (file.size === 0) {
      errorCode ??= "empty_file";
      continue;
    }
    if (file.size > MEDIA_MAX_BYTES) {
      errorCode ??= "file_too_large";
      continue;
    }
    if (existingCount + accepted.length >= maxFiles) {
      errorCode ??= "too_many_files";
      break;
    }
    accepted.push(file);
  }

  return { accepted, errorCode };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
