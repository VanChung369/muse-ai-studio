import { normalizeSearchText } from "@/lib/string";
import { createId } from "@/lib/id";

import { PROJECT_FILTERS, PROJECT_SORTS } from "../constants";
import { projectSchema } from "../schemas";
import type {
  Project,
  ProjectDraft,
  ProjectFilter,
  ProjectSort,
} from "../types";

export function resolveProjectFilter(value: string | null): ProjectFilter {
  return PROJECT_FILTERS.find((filter) => filter === value) ?? "all";
}

export function resolveProjectSort(value: string | null): ProjectSort {
  return PROJECT_SORTS.find((sort) => sort === value) ?? "updated";
}

export function matchesProjectFilter(
  project: Project,
  filter: ProjectFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "inProgress")
    return project.status !== "completed" && project.status !== "cancelled";
  return project.status === filter;
}

export function getProjectCounts(
  projects: Project[],
): Record<ProjectFilter, number> {
  return {
    all: projects.length,
    inProgress: projects.filter((project) =>
      matchesProjectFilter(project, "inProgress"),
    ).length,
    completed: projects.filter((project) => project.status === "completed")
      .length,
    cancelled: projects.filter((project) => project.status === "cancelled")
      .length,
  };
}

export function getVisibleProjects(
  projects: Project[],
  query: string,
  filter: ProjectFilter,
  sort: ProjectSort,
  language: string,
): Project[] {
  const normalizedQuery = normalizeSearchText(query.trim());
  const collator = new Intl.Collator(language, {
    sensitivity: "base",
    numeric: true,
  });

  return projects
    .filter(
      (project) =>
        matchesProjectFilter(project, filter) &&
        normalizeSearchText(project.name).includes(normalizedQuery),
    )
    .sort((left, right) => {
      if (sort === "name") return collator.compare(left.name, right.name);
      if (sort === "duration")
        return (
          right.durationSeconds - left.durationSeconds ||
          right.updatedAt.localeCompare(left.updatedAt)
        );
      return right.updatedAt.localeCompare(left.updatedAt);
    });
}

export function getFeaturedProject(projects: Project[]): Project | undefined {
  const recent = [...projects].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
  return (
    recent.find((project) => project.status === "ready") ??
    recent.find((project) => matchesProjectFilter(project, "inProgress"))
  );
}

// Validate entries one at a time so a single bad entry (a manual edit or an
// older schema) hides only itself instead of resetting the whole list.
export function readDemoProjects(
  value: unknown,
  fallback: Project[],
): Project[] {
  if (!Array.isArray(value)) return fallback;
  return value.flatMap((item) => {
    const result = projectSchema.safeParse(item);
    return result.success ? [result.data] : [];
  });
}

export function createProjectDraft(values: ProjectDraft): Project {
  return {
    ...values,
    id: createId(),
    status: "draft",
    updatedAt: new Date().toISOString(),
    sceneCount: 0,
    completedScenes: 0,
    coverTone: "coffee",
    scenes: [],
  };
}
