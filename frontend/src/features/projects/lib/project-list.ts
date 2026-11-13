import { ROUTES } from "@/constants/routes";
import {
  PROJECT_FILTERS,
  PROJECT_QUERY_KEYS,
  PROJECT_SORTS,
} from "../constants";
import type { ProjectFilter, ProjectSort, ProjectStatus } from "../types";

// Search, filtering, sorting, counts, and the featured project are computed
// by GET /api/projects (see backend/api-contract.md).

export function resolveProjectFilter(value: string | null): ProjectFilter {
  return PROJECT_FILTERS.find((filter) => filter === value) ?? "all";
}

export function resolveProjectSort(value: string | null): ProjectSort {
  return PROJECT_SORTS.find((sort) => sort === value) ?? "updated";
}


/** The project list with this project's details sheet open. */
export function projectDetailsHref(id: string) {
  return `${ROUTES.PROJECTS}?${new URLSearchParams({ [PROJECT_QUERY_KEYS.SELECTED]: id })}`;
}

// A project's workspace steps, in order (design boards 11–14).
export const PROJECT_STEPS = ["idea", "script", "render", "output"] as const;
export type ProjectStep = (typeof PROJECT_STEPS)[number];

/** A project opened as a workspace; lands on the step where work continues. */
export function projectWorkspaceHref(id: string) {
  return `${ROUTES.PROJECTS}/${encodeURIComponent(id)}`;
}

export function projectStepHref(id: string, step: ProjectStep) {
  return `${projectWorkspaceHref(id)}/${step}`;
}

/** The step a project's work continues at. */
export function resumeStep(project: {
  status: ProjectStatus;
  sceneCount: number;
}): ProjectStep {
  if (project.status === "completed") return "output";
  if (project.sceneCount === 0) return "idea";
  return project.status === "ready" || project.status === "draft"
    ? "script"
    : "render";
}

export function isProjectDeletable(status: ProjectStatus): boolean {
  return status !== "planning" && status !== "rendering" && status !== "cancelling";
}
