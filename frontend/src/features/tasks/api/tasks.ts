import { API_ENDPOINTS } from "@/constants/api";
import { requestJson } from "@/lib/http";
import { TASK_PAGE_SIZE } from "../constants";
import { taskCountsSchema, taskListSchema, taskSchema } from "../schemas";
import type { TaskAction, TaskListParams } from "../types";

export async function fetchTasks(
  params: TaskListParams,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const search = new URLSearchParams({
    status: params.status,
    limit: String(TASK_PAGE_SIZE),
  });
  if (params.projectId) search.set("projectId", params.projectId);
  if (cursor) search.set("cursor", cursor);
  return taskListSchema.parse(
    await requestJson(`${API_ENDPOINTS.TASKS}?${search}`, { signal }),
  );
}

export async function fetchTask(id: string, signal?: AbortSignal) {
  return taskSchema.parse(
    await requestJson(`${API_ENDPOINTS.TASKS}/${encodeURIComponent(id)}`, {
      signal,
    }),
  );
}

export async function fetchTaskSummary(signal?: AbortSignal) {
  return taskCountsSchema.parse(
    await requestJson(`${API_ENDPOINTS.TASKS}/summary`, { signal }),
  );
}

export async function runTaskAction(values: {
  id: string;
  action: TaskAction;
  switchAccount?: boolean;
  confirmDuplicate?: boolean;
}) {
  const { id, action, ...body } = values;
  if (action === "delete") {
    await requestJson(`${API_ENDPOINTS.TASKS}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    // Nothing is left to return.
    return null;
  }
  return taskSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.TASKS}/${encodeURIComponent(id)}/${action}`,
      {
        method: "POST",
        ...(action === "retry" ? { body: JSON.stringify(body) } : {}),
      },
    ),
  );
}
