import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { taskKeys } from "@/features/tasks/api/query-keys";
import { projectKeys } from "../api/query-keys";
import {
  cancelRender,
  fetchRender,
  renderKey,
  restartRender,
  resumeRender,
  startRender,
} from "../api/render";
import { RENDER_POLL_INTERVAL_MS } from "../constants";
import { isRenderActive } from "../lib/project-render";
import type { ProjectRender } from "../types";

export function useProjectRender(projectId: string) {
  const client = useQueryClient();
  const key = renderKey(projectId);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchRender(projectId, signal),
    retry: false,
    refetchInterval: ({ state }) =>
      state.data && isRenderActive(state.data.status)
        ? RENDER_POLL_INTERVAL_MS
        : false,
  });

  function refreshProject() {
    void client.invalidateQueries({ queryKey: projectKeys.detail(projectId) });
    void client.invalidateQueries({ queryKey: projectKeys.lists });
  }

  const options = {
    retry: false,
    onSuccess: (render: ProjectRender) => {
      client.setQueryData(key, render);
      refreshProject();
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
    // A refusal usually means the render moved on; show where it is now.
    onError: () => void client.invalidateQueries({ queryKey: key }),
  };

  return {
    query,
    refreshProject,
    start: useMutation({ mutationFn: startRender, ...options }),
    cancel: useMutation({ mutationFn: cancelRender, ...options }),
    resume: useMutation({ mutationFn: resumeRender, ...options }),
    restart: useMutation({ mutationFn: restartRender, ...options }),
  };
}
