import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { ApiError, requestJson } from "@/lib/http";
import { mediaMime } from "../lib/project-media";

export const projectMediaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["video", "image", "audio"]),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  seconds: z.number().nonnegative().nullable(),
  width: z.number().int().nonnegative().nullable(),
  height: z.number().int().nonnegative().nullable(),
  source: z.enum(["upload", "muse"]),
  url: z.string(),
  thumbnailUrl: z.string().nullable(),
  // A drawing of an audio file's sound; null for video and pictures.
  waveformUrl: z.string().nullable(),
});

export type ProjectMedia = z.infer<typeof projectMediaSchema>;

export const mediaKey = (projectId: string) =>
  ["projects", "media", projectId] as const;

const mediaPath = (projectId: string) =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(projectId)}/media`;

export async function fetchMedia(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectMedia[]> {
  return projectMediaSchema
    .array()
    .parse(await requestJson(mediaPath(projectId), { signal }));
}

export async function uploadMedia({
  projectId,
  file,
}: {
  projectId: string;
  file: File;
}): Promise<ProjectMedia> {
  // The file is the raw body: its type travels in Content-Type and its
  // name in the query, so no multipart encoding is involved.
  const search = new URLSearchParams({ name: file.name });
  return projectMediaSchema.parse(
    await requestJson(`${mediaPath(projectId)}?${search}`, {
      method: "POST",
      headers: {
        "Content-Type": mediaMime(file) || "application/octet-stream",
      },
      body: file,
    }),
  );
}

export async function deleteMedia({
  projectId,
  mediaId,
}: {
  projectId: string;
  mediaId: string;
}): Promise<void> {
  try {
    await requestJson(
      `${mediaPath(projectId)}/${encodeURIComponent(mediaId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    // Already gone (another tab, or a lost first response) is fine.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}
