import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { createProject, fetchProject, fetchProjects } from "../api/projects";
import { projectKeys } from "../api/query-keys";
import type { ProjectListParams } from "../types";

export function useProjectsQuery(params: ProjectListParams) {
  return useInfiniteQuery({
    queryKey: projectKeys.list(params),
    queryFn: ({ pageParam, signal }) => fetchProjects(params, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    // Keep the current grid on screen while a new search or filter loads.
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useProjectQuery(id: string | null) {
  return useQuery({
    queryKey: projectKeys.detail(id ?? ""),
    queryFn: ({ signal }) => fetchProject(id!, signal),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useCreateProject() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: createProject,
    retry: false,
    onSuccess: (project) => {
      client.setQueryData(projectKeys.detail(project.id), project);
      // Counts, featured project, and page boundaries all come from the
      // server, so refetch every cached list instead of patching pages.
      void client.invalidateQueries({ queryKey: projectKeys.lists });
    },
  });
}
