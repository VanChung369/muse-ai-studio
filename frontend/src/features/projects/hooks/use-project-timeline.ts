import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { taskKeys } from "@/features/tasks/api/query-keys";
import { projectKeys } from "../api/query-keys";
import { renderKey } from "../api/render";
import { fetchTimeline, saveTimeline, timelineKey } from "../api/timeline";
import { RENDER_POLL_INTERVAL_MS } from "../constants";
import { isRenderActive } from "../lib/project-render";

export function useProjectTimeline(projectId: string) {
  const client = useQueryClient();
  const key = timelineKey(projectId);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchTimeline(projectId, signal),
    retry: false,
    // While the film is being merged, wait for it to become editable again.
    refetchInterval: ({ state }) =>
      state.data && isRenderActive(state.data.status)
        ? RENDER_POLL_INTERVAL_MS
        : false,
  });

  const save = useMutation({
    mutationFn: saveTimeline,
    retry: false,
    onSuccess: (timeline) => {
      client.setQueryData(key, timeline);
      // Saving starts a new merge: the film, its status and its tasks change.
      void client.invalidateQueries({ queryKey: renderKey(projectId) });
      void client.invalidateQueries({
        queryKey: projectKeys.detail(projectId),
      });
      void client.invalidateQueries({ queryKey: projectKeys.lists });
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: () => void client.invalidateQueries({ queryKey: key }),
  });

  return { query, save };
}
