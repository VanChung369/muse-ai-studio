import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { projectMediaSchema, type ProjectMedia } from "@/features/projects/api/media";
import { mediaMime } from "@/features/projects/lib/project-media";
import { ApiError, requestJson } from "@/lib/http";
import { LIBRARY_PAGE_SIZE } from "../lib/library";

const LIBRARY_ENDPOINT = "/api/library";

export const libraryItemSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["upload", "scene", "film"]),
  kind: z.enum(["image", "video", "audio"]),
  source: z.enum(["studio", "upload", "quick"]),
  title: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  sceneNumber: z.number().int().nullable(),
  assetId: z.string().nullable(),
  seconds: z.number().nonnegative().nullable(),
  size: z.number().int().nonnegative().nullable(),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  waveformUrl: z.string().nullable(),
  createdAt: z.string(),
  deletable: z.boolean(),
});

export const libraryPageSchema = z.object({
  items: libraryItemSchema.array(),
  total: z.number().int().nonnegative(),
  counts: z.object({
    all: z.number().int().nonnegative(),
    image: z.number().int().nonnegative(),
    video: z.number().int().nonnegative(),
    audio: z.number().int().nonnegative(),
  }),
});

export type LibraryItem = z.infer<typeof libraryItemSchema>;
export type LibraryPage = z.infer<typeof libraryPageSchema>;

export type LibraryFilters = {
  kind: "all" | "image" | "video" | "audio";
  source: "all" | "studio" | "upload" | "quick";
  q: string;
};

export const libraryKeys = {
  all: ["library"] as const,
  list: (filters: LibraryFilters) => ["library", "list", filters] as const,
};

export async function fetchLibrary(
  filters: LibraryFilters,
  offset: number,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const search = new URLSearchParams({
    limit: String(LIBRARY_PAGE_SIZE),
    offset: String(offset),
  });
  if (filters.kind !== "all") search.set("kind", filters.kind);
  if (filters.source !== "all") search.set("source", filters.source);
  const q = filters.q.trim();
  if (q) search.set("q", q);

  return libraryPageSchema.parse(
    await requestJson(`${LIBRARY_ENDPOINT}?${search}`, { signal }),
  );
}

export async function uploadToLibrary(file: File): Promise<LibraryItem> {
  const search = new URLSearchParams({ name: file.name });
  return libraryItemSchema.parse(
    await requestJson(`${LIBRARY_ENDPOINT}?${search}`, {
      method: "POST",
      headers: {
        "Content-Type": mediaMime(file) || "application/octet-stream",
      },
      body: file,
    }),
  );
}

export async function deleteLibraryAsset(assetId: string): Promise<void> {
  try {
    await requestJson(
      `${LIBRARY_ENDPOINT}/assets/${encodeURIComponent(assetId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    // Already gone is treated as a completed delete.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}

// Files the archive route takes in one request (mirrors the server).
export const ARCHIVE_LIMIT = 100;

/** A file's address asked for as a download, so it keeps its own name. */
export function libraryDownloadHref(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}download=1`;
}

export function libraryArchiveHref(ids: string[]): string {
  const search = new URLSearchParams();
  for (const id of ids) {
    search.append("ids", id);
  }
  return `${LIBRARY_ENDPOINT}/archive?${search}`;
}

export async function importToProject({
  projectId,
  ids,
}: {
  projectId: string;
  ids: string[];
}): Promise<ProjectMedia[]> {
  return projectMediaSchema.array().parse(
    await requestJson(
      `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(projectId)}/media/import`,
      {
        method: "POST",
        body: JSON.stringify({ ids }),
      },
    ),
  );
}
