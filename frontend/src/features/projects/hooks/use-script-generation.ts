import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelScriptGeneration,
  fetchScriptGeneration,
  scriptGenerationKey,
  startScriptGeneration,
} from "../api/script-generation";
import { projectKeys } from "../api/query-keys";
import { taskKeys } from "@/features/tasks/api/query-keys";

export function useScriptGeneration(projectId: string) {
  const client = useQueryClient();
  const key = scriptGenerationKey(projectId);
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchScriptGeneration(projectId, signal),
    retry: false,
    refetchInterval: ({ state }) =>
      state.data?.status === "queued" || state.data?.status === "running"
        ? 1500
        : false,
  });
  const start = useMutation({
    mutationFn: startScriptGeneration,
    retry: false,
    onSuccess: (task) => {
      client.setQueryData(key, task);
      void client.invalidateQueries({ queryKey: taskKeys.all });
      void client.invalidateQueries({
        queryKey: projectKeys.detail(projectId),
      });
      void client.invalidateQueries({ queryKey: projectKeys.lists });
    },
  });
  const cancel = useMutation({
    mutationFn: cancelScriptGeneration,
    retry: false,
    onSuccess: (task) => {
      client.setQueryData(key, task);
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
  });
  return { query, start, cancel };
}
