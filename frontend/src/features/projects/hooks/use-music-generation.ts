import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { taskKeys } from "@/features/tasks/api/query-keys";
import { isTaskActive } from "@/features/tasks/lib/task-format";
import { mediaKey } from "../api/media";
import { fetchMusicTask, musicKey, requestMusic } from "../api/music";
import { RENDER_POLL_INTERVAL_MS } from "../constants";

// Music made by Muse for a project: the latest request, followed while it
// runs, and a way to ask for another.
export function useMusicGeneration(projectId: string) {
  const client = useQueryClient();
  const key = musicKey(projectId);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchMusicTask(projectId, signal),
    retry: false,
    refetchInterval: ({ state }) =>
      state.data && isTaskActive(state.data) ? RENDER_POLL_INTERVAL_MS : false,
  });

  // The finished piece is a new file among the project's media.
  const status = query.data?.status;
  useEffect(() => {
    if (status === "succeeded")
      void client.invalidateQueries({ queryKey: mediaKey(projectId) });
  }, [client, projectId, status]);

  const request = useMutation({
    mutationFn: requestMusic,
    retry: false,
    onSuccess: (task) => {
      client.setQueryData(key, task);
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
    // A refusal usually means a request is already running: show it.
    onError: () => void client.invalidateQueries({ queryKey: key }),
  });

  return { query, request };
}
