import type { TaskListParams } from "../types";

export const taskKeys = {
  all: ["tasks"] as const,
  lists: ["tasks", "list"] as const,
  list: (params: TaskListParams) => [...taskKeys.lists, params] as const,
  detail: (id: string) => ["tasks", "detail", id] as const,
  summary: ["tasks", "summary"] as const,
};
