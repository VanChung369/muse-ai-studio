import type { TFunction } from "i18next";

import { formatRelativeTime } from "@/lib/format";
import { ApiError } from "@/lib/http";
import type { LibraryItem } from "../api/library";

export const LIBRARY_PAGE_SIZE = 60;

export const LIBRARY_KINDS = ["all", "image", "video", "audio"] as const;
export const LIBRARY_SOURCES = [
  "all",
  "studio",
  "quick",
  "api",
  "upload",
] as const;

export const LIBRARY_ERROR_CODES = [
  "unsupported_file",
  "file_too_large",
  "too_many_files",
  "ffmpeg_unavailable",
  "empty_file",
  "unreadable_file",
  "not_deletable",
  "library_item_not_found",
] as const;

export type LibraryErrorCode = (typeof LIBRARY_ERROR_CODES)[number];
export type LibraryErrorKey =
  | `library.errors.${LibraryErrorCode}`
  | "library.errors.unknown";

export const PICKER_ERROR_CODES = [
  "too_many_files",
  "project_busy",
  "ffmpeg_unavailable",
  "library_item_not_found",
  "project_not_found",
] as const;

export type PickerErrorCode = (typeof PICKER_ERROR_CODES)[number];
export type PickerErrorKey =
  | `library.picker.errors.${PickerErrorCode}`
  | "library.picker.errors.unknown";

export function libraryErrorKey(error: unknown): LibraryErrorKey {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = LIBRARY_ERROR_CODES.find((value) => value === code);
  return known
    ? (`library.errors.${known}` as const)
    : "library.errors.unknown";
}

export function pickerErrorKey(error: unknown): PickerErrorKey {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = PICKER_ERROR_CODES.find((value) => value === code);
  return known
    ? (`library.picker.errors.${known}` as const)
    : "library.picker.errors.unknown";
}

export function libraryItemTitle(item: LibraryItem, t: TFunction): string {
  if (item.role === "scene") {
    if (item.sceneNumber !== null) {
      const sceneLabel = t("library.scene", { number: item.sceneNumber });
      return item.projectName
        ? `${item.projectName} · ${sceneLabel}`
        : sceneLabel;
    }
    return item.title;
  }
  if (item.role === "film") {
    return item.projectName ?? item.title;
  }
  return item.title;
}

export function libraryItemMeta(
  item: LibraryItem,
  t: TFunction,
  language: string,
  now: number,
): string {
  const sourceLabel = t(`library.sources.${item.source}`);
  const prefix =
    item.role === "film"
      ? `${sourceLabel} · ${t("library.film")}`
      : sourceLabel;
  return `${prefix} · ${formatRelativeTime(item.createdAt, language, now)}`;
}
