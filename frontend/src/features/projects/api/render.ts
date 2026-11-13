import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { taskSchema } from "@/features/tasks/schemas";
import { requestJson } from "@/lib/http";
import { PROJECT_STATUSES } from "../constants";

const count = z.number().int().nonnegative();

export const projectRenderSchema = z.object({
  projectId: z.string(),
  status: z.enum(PROJECT_STATUSES),
  sceneCount: count,
  completedScenes: count,
  scenes: z.array(
    z.object({
      number: z.number().int().min(1),
      title: z.string(),
      durationSeconds: z.number().int().positive(),
      // Null until the scene has a clip.
      videoUrl: z.string().nullable(),
      // A still of the clip, for the player's poster.
      thumbnailUrl: z.string().nullable(),
      // Null until a render has been started.
      task: taskSchema.nullable(),
    }),
  ),
  // The final merge step.
  merge: taskSchema.nullable(),
  videoUrl: z.string().nullable(),
  usableAccounts: count,
});

export const renderKey = (id: string) => ["projects", "render", id] as const;

const renderPath = (id: string, action = "") =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}/render${action}`;

export async function fetchRender(id: string, signal?: AbortSignal) {
  return projectRenderSchema.parse(
    await requestJson(renderPath(id), { signal }),
  );
}

export async function startRender(id: string) {
  return projectRenderSchema.parse(
    await requestJson(renderPath(id), { method: "POST" }),
  );
}

export async function cancelRender(id: string) {
  return projectRenderSchema.parse(
    await requestJson(renderPath(id, "/cancel"), { method: "POST" }),
  );
}

export async function restartRender(values: { id: string; fromScene: number }) {
  return projectRenderSchema.parse(
    await requestJson(renderPath(values.id, "/restart"), {
      method: "POST",
      body: JSON.stringify({ fromScene: values.fromScene }),
    }),
  );
}

export async function resumeRender(values: {
  id: string;
  confirmDuplicate: boolean;
}) {
  return projectRenderSchema.parse(
    await requestJson(renderPath(values.id, "/resume"), {
      method: "POST",
      body: JSON.stringify({ confirmDuplicate: values.confirmDuplicate }),
    }),
  );
}
