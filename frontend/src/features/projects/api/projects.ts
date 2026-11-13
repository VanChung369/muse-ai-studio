import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { ApiError, requestJson } from "@/lib/http";
import { PROJECT_PAGE_SIZE } from "../constants";
import {
  featuredProjectSchema,
  projectCreateSchema,
  projectSchema,
  projectSummarySchema,
  projectScriptDraftSchema,
} from "../schemas";
import type {
  ProjectCreateDraft,
  ProjectListParams,
  ProjectScriptDraft,
  ProjectSettings,
} from "../types";

const count = z.number().int().nonnegative();

export const projectListSchema = z.object({
  items: projectSummarySchema.array(),
  total: count,
  nextCursor: z.string().min(1).nullable(),
  counts: z.object({
    all: count,
    inProgress: count,
    completed: count,
    cancelled: count,
  }),
  featured: featuredProjectSchema.nullable(),
});

export type ProjectListPage = z.infer<typeof projectListSchema>;

export async function fetchProjects(
  params: ProjectListParams,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const search = new URLSearchParams({ limit: String(PROJECT_PAGE_SIZE) });
  if (params.q.trim()) search.set("q", params.q.trim());
  if (params.status !== "all") search.set("status", params.status);
  if (params.sort !== "updated") search.set("sort", params.sort);
  if (cursor) search.set("cursor", cursor);

  return projectListSchema.parse(
    await requestJson(`${API_ENDPOINTS.PROJECTS}?${search}`, { signal }),
  );
}

export async function fetchProject(id: string, signal?: AbortSignal) {
  return projectSchema.parse(
    await requestJson(`${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}`, {
      signal,
    }),
  );
}

export async function createProject(values: ProjectCreateDraft) {
  const body = projectCreateSchema.parse(values);
  return projectSchema.parse(
    await requestJson(API_ENDPOINTS.PROJECTS, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}

export async function updateProject({
  id,
  values,
}: {
  id: string;
  // Only the fields that changed. `discardScript` allows a new duration to
  // drop a script written for the old one.
  values: Partial<ProjectSettings> & { discardScript?: boolean };
}) {
  return projectSchema.parse(
    await requestJson(`${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  );
}

export async function saveProjectScript({
  id,
  values,
}: {
  id: string;
  values: ProjectScriptDraft;
}) {
  const draft = projectScriptDraftSchema.parse(values);
  return projectSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}/script`,
      {
        method: "PUT",
        body: JSON.stringify({
          ...draft,
          scenes: draft.scenes.map((scene, index) => ({
            ...scene,
            number: index + 1,
          })),
        }),
      },
    ),
  );
}

export async function deleteProject(id: string): Promise<void> {
  try {
    await requestJson(`${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    // Another tab may already have removed the project, or the first
    // successful response may have been lost before a manual retry.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}
