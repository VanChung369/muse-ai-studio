import type { z } from "zod";
import type { TASK_FILTERS } from "./constants";
import type { taskSchema } from "./schemas";

export type Task = z.infer<typeof taskSchema>;
export type TaskFilter = (typeof TASK_FILTERS)[number];
export type TaskListParams = { status: TaskFilter; projectId: string | null };
export type TaskAction = "cancel" | "retry" | "delete";
