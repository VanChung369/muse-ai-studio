import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { scriptGenerationKey } from "@/features/projects/api/script-generation";
import { projectKeys } from "@/features/projects/api/query-keys";
import { ApiError } from "@/lib/http";
import { taskKeys } from "../api/query-keys";
import {
  fetchTask,
  fetchTasks,
  fetchTaskSummary,
  runTaskAction,
} from "../api/tasks";
import { TASK_POLL_INTERVAL_MS } from "../constants";
import type { TaskListParams } from "../types";

export function useTasksQuery(params: TaskListParams) {
  return useInfiniteQuery({
    queryKey: taskKeys.list(params),
    queryFn: ({ pageParam, signal }) => fetchTasks(params, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor,
    retry: false,
    refetchInterval: TASK_POLL_INTERVAL_MS,
  });
}

export function useTaskQuery(id: string | null) {
  return useQuery({
    queryKey: taskKeys.detail(id ?? ""),
    queryFn: ({ signal }) => fetchTask(id!, signal),
    enabled: Boolean(id),
    retry: false,
    refetchInterval: ({ state }) =>
      state.error instanceof ApiError && state.error.status === 404
        ? false
        : TASK_POLL_INTERVAL_MS,
  });
}

export function useTaskSummary() {
  return useQuery({
    queryKey: taskKeys.summary,
    queryFn: ({ signal }) => fetchTaskSummary(signal),
    retry: false,
    refetchInterval: TASK_POLL_INTERVAL_MS,
  });
}

export function useTaskAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runTaskAction,
    retry: false,
    onSuccess: async (task, values) => {
      // Stop older reads before publishing the mutation response.
      await client.cancelQueries({ queryKey: taskKeys.all });
      if (!task) {
        // Deleted: every list that showed it (tasks, a project's latest
        // run, Quick Create) reads again.
        client.removeQueries({ queryKey: taskKeys.detail(values.id) });
        void client.invalidateQueries();
        return;
      }
      client.setQueryData(taskKeys.detail(task.id), task);
      void client.invalidateQueries({ queryKey: taskKeys.all });
      if (task.projectId) {
        void client.invalidateQueries({
          queryKey: scriptGenerationKey(task.projectId),
        });
        void client.invalidateQueries({
          queryKey: projectKeys.detail(task.projectId),
        });
        void client.invalidateQueries({ queryKey: projectKeys.lists });
      }
    },
    onError: () => {
      // A concurrent completion can reject an otherwise valid action.
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
}
