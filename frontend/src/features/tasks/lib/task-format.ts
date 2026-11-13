import { ROUTES } from "@/constants/routes";
import { PROJECT_QUERY_KEYS } from "@/features/projects/constants";
import { formatDuration } from "@/lib/format";
import { ApiError } from "@/lib/http";
import {
  TASK_ERROR_CODES,
  TASK_FILTERS,
  TASK_KINDS,
  TASK_QUERY_PARAMS,
} from "../constants";
import type { Task } from "../types";

export function resolveTaskFilter(value: string | null) {
  return TASK_FILTERS.find((filter) => filter === value) ?? "all";
}

export function taskKindKey(kind: string) {
  const known = TASK_KINDS.find((value) => value === kind);
  return known ? (`tasks.kinds.${known}` as const) : "tasks.kinds.other";
}

export function isTaskActive(task: Task) {
  return task.status === "running" || task.status === "queued";
}

export function canRetryTask(task: Task) {
  // retryable describes safe automatic retries. The API also allows manual retries.
  return (
    task.status === "failed" ||
    task.status === "interrupted" ||
    task.status === "cancelled"
  );
}

export function taskErrorKey(code?: string) {
  const known = TASK_ERROR_CODES.find((value) => value === code);
  return known ? (`tasks.errors.${known}` as const) : "tasks.errors.unknown";
}

export function taskActionErrorKey(error: unknown) {
  if (error instanceof ApiError && error.kind === "network")
    return "tasks.errors.network";
  return taskErrorKey(error instanceof ApiError ? error.code : undefined);
}

export function taskProjectHref(id: string) {
  return `${ROUTES.PROJECTS}?${new URLSearchParams({ [PROJECT_QUERY_KEYS.SELECTED]: id })}`;
}

export function projectTasksHref(id: string) {
  return `${ROUTES.TASKS}?${new URLSearchParams({ [TASK_QUERY_PARAMS.PROJECT]: id })}`;
}

export function taskElapsed(task: Task, now: number) {
  if (!task.startedAt) return null;
  const end = task.finishedAt ? Date.parse(task.finishedAt) : now;
  return formatDuration(
    Math.max(0, Math.floor((end - Date.parse(task.startedAt)) / 1000)),
  );
}

export function formatTaskTimestamp(timestamp: string, language: string) {
  return new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}
