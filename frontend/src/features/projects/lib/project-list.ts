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

/** The full-page workspace for one project. */
export function projectStudioHref(id: string) {
  return `${ROUTES.PROJECTS}/${encodeURIComponent(id)}/studio`;
}

export function isProjectDeletable(status: ProjectStatus): boolean {
  return status !== "planning" && status !== "rendering" && status !== "cancelling";
}
