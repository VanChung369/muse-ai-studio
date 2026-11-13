import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { taskKeys } from "@/features/tasks/api/query-keys";
import { ApiError } from "@/lib/http";

import {
  createProject,
  deleteProject,
  fetchProject,
  fetchProjects,
  saveProjectScript,
  updateProject,
} from "../api/projects";
import { projectKeys } from "../api/query-keys";
import { renderKey } from "../api/render";
import { timelineKey } from "../api/timeline";
import type { ProjectListParams } from "../types";

export function useProjectsQuery(params: ProjectListParams) {
  return useInfiniteQuery({
    queryKey: projectKeys.list(params),
    queryFn: ({ pageParam, signal }) =>
      fetchProjects(params, pageParam, signal),
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

export function useUpdateProject() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: updateProject,
    retry: false,
    onSuccess: (project) => {
      client.setQueryData(projectKeys.detail(project.id), project);
      void client.invalidateQueries({ queryKey: projectKeys.lists });
      // Muting a finished film merges it again: the render, its timeline and
      // the task list all have something new to show.
      void client.invalidateQueries({ queryKey: renderKey(project.id) });
      void client.invalidateQueries({ queryKey: timelineKey(project.id) });
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
    onError: (error, { id }) => {
      // A refusal means the project moved on (a render started, a script was
      // saved): show what it is now.
      if (error instanceof ApiError && error.status === 409)
        void client.invalidateQueries({ queryKey: projectKeys.detail(id) });
    },
  });
}

export function useSaveProjectScript() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: saveProjectScript,
    retry: false,
    onSuccess: (project) => {
      client.setQueryData(projectKeys.detail(project.id), project);
      void client.invalidateQueries({ queryKey: projectKeys.lists });
    },
    onError: (error, { id }) => {
      if (!(error instanceof ApiError) || error.status !== 409) return;
      // A conflict means the script changed; "locked" means the status did.
      // Both affect the detail sheet, cards, and the featured project.
      void client.invalidateQueries({ queryKey: projectKeys.detail(id) });
      void client.invalidateQueries({ queryKey: projectKeys.lists });
    },
  });
}

export function useDeleteProject() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: deleteProject,
    retry: false,
    onSuccess: async (_, id) => {
      await client.cancelQueries({
        queryKey: projectKeys.detail(id),
        exact: true,
      });
      client.removeQueries({ queryKey: projectKeys.detail(id), exact: true });
      // Reset page boundaries and remove deleted cards even if a later list
      // refresh fails. The active view reloads from the first page.
      void client.resetQueries({ queryKey: projectKeys.lists });
    },
    onError: (error, id) => {
      if (error instanceof ApiError && error.status === 409) {
        void client.invalidateQueries({ queryKey: projectKeys.detail(id) });
        void client.invalidateQueries({ queryKey: projectKeys.lists });
      }
    },
  });
}
