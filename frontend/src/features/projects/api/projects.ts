import { z } from "zod";

import { API_ENDPOINTS } from "@/constants/api";
import { requestJson } from "@/lib/http";
import { PROJECT_PAGE_SIZE } from "../constants";
import {
  featuredProjectSchema,
  projectDraftSchema,
  projectSchema,
  projectSummarySchema,
} from "../schemas";
import type { ProjectDraft, ProjectListParams } from "../types";

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

export async function createProject(values: ProjectDraft) {
  const body = projectDraftSchema.parse(values);
  return projectSchema.parse(
    await requestJson(API_ENDPOINTS.PROJECTS, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  );
}
