import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { requestJson } from "@/lib/http";
import { PROJECT_STATUSES } from "../constants";

const seconds = z.number().nonnegative();

export const projectTimelineSchema = z.object({
  projectId: z.string(),
  status: z.enum(PROJECT_STATUSES),
  // The timeline can change once the film is finished and not being merged.
  editable: z.boolean(),
  // Scenes in play order; only scenes that have a clip.
  items: z.array(
    z.object({
      scene: z.number().int().min(1),
      title: z.string(),
      // Length of the rendered clip.
      clipSeconds: seconds,
      // The part of the clip that is kept, in seconds into it.
      start: seconds,
      end: seconds,
      // False leaves the scene out of the film.
      enabled: z.boolean(),
      videoUrl: z.string(),
      thumbnailUrl: z.string(),
    }),
  ),
  totalSeconds: seconds,
});

export const timelineKey = (id: string) =>
  ["projects", "timeline", id] as const;

const timelinePath = (id: string) =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}/timeline`;

export async function fetchTimeline(id: string, signal?: AbortSignal) {
  return projectTimelineSchema.parse(
    await requestJson(timelinePath(id), { signal }),
  );
}

export async function saveTimeline(values: {
  id: string;
  items: { scene: number; start: number; end: number; enabled: boolean }[];
}) {
  return projectTimelineSchema.parse(
    await requestJson(timelinePath(values.id), {
      method: "PUT",
      body: JSON.stringify({ items: values.items }),
    }),
  );
}
