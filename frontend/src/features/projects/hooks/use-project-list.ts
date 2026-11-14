import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { ApiError } from "@/lib/http";

import { projectKeys } from "../api/query-keys";
import { uploadReference } from "../api/references";
import { PROJECT_QUERY_KEYS } from "../constants";
import {
  useCreateProject,
  useProjectQuery,
  useProjectsQuery,
} from "./use-project-queries";
import { resolveProjectFilter, resolveProjectSort } from "../lib/project-list";
import type {
  Project,
  ProjectCreateDraft,
  ProjectFilter,
  ProjectSort,
  ProjectSummary,
} from "../types";

const SEARCH_DEBOUNCE_MS = 250;
const NO_COUNTS: Record<ProjectFilter, number> = {
  all: 0,
  inProgress: 0,
  completed: 0,
  cancelled: 0,
};

export function useProjectList() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const createMutation = useCreateProject();
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpenState] = useState(false);
  const projectTriggerRef = useRef<HTMLElement | null>(null);
  // True when the open sheet added its own history entry, so closing it can
  // step back instead of leaving a duplicate /projects entry behind.
  const sheetPushedHistory = useRef(false);
  const [lastCreated, setLastCreated] = useState<Project | null>(null);
  const [lastCreatedUploadFailures, setLastCreatedUploadFailures] = useState(0);
  const [lastDeleted, setLastDeleted] = useState<string | null>(null);
  const query = searchParams.get(PROJECT_QUERY_KEYS.SEARCH) ?? "";
  const filter = resolveProjectFilter(
    searchParams.get(PROJECT_QUERY_KEYS.FILTER),
  );
  const sort = resolveProjectSort(searchParams.get(PROJECT_QUERY_KEYS.SORT));
  // The input updates on every keystroke; the request waits for a pause.
  const debouncedQuery = useDebouncedValue(query.trim(), SEARCH_DEBOUNCE_MS);
  const projectsQuery = useProjectsQuery({
    q: debouncedQuery,
    status: filter,
    sort,
  });
  const pages = projectsQuery.data?.pages ?? [];
  const firstPage = pages[0];
  // Keyset pages never overlap, but a refetch after a create can race with
  // "Load more"; drop duplicates defensively.
  const seen = new Set<string>();
  const projects: ProjectSummary[] = pages
    .flatMap((page) => page.items)
    .filter((project) => !seen.has(project.id) && seen.add(project.id));
  const selectedId = searchParams.get(PROJECT_QUERY_KEYS.SELECTED);
  const projectQuery = useProjectQuery(selectedId);

  function setCreateOpen(next: boolean) {
    createMutation.reset();
    setCreateOpenState(next);
  }

  useEffect(() => {
    // Browser Back/Forward can close the sheet without closeProject().
    if (!selectedId) sheetPushedHistory.current = false;
  }, [selectedId]);

  function updateParameter(key: string, value: string, defaultValue = "") {
    setLastCreated(null);
    setLastCreatedUploadFailures(0);
    setLastDeleted(null);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === defaultValue) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  function clearFilters() {
    setLastCreated(null);
    setLastCreatedUploadFailures(0);
    setLastDeleted(null);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(PROJECT_QUERY_KEYS.SEARCH);
        next.delete(PROJECT_QUERY_KEYS.FILTER);
        return next;
      },
      { replace: true },
    );
  }

  function selectProject(id: string) {
    projectTriggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    setLastCreated(null);
    setLastCreatedUploadFailures(0);
    setLastDeleted(null);
    sheetPushedHistory.current = true;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(PROJECT_QUERY_KEYS.SELECTED, id);
      return next;
    });
  }

  function closeProject() {
    if (sheetPushedHistory.current) {
      sheetPushedHistory.current = false;
      navigate(-1);
      return;
    }
    // Opened from a shared link: there is no entry of ours to go back to.
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(PROJECT_QUERY_KEYS.SELECTED);
        return next;
      },
      { replace: true },
    );
  }

  function restoreProjectFocus(event: Event) {
    event.preventDefault();
    if (projectTriggerRef.current?.isConnected)
      projectTriggerRef.current.focus();
    else document.getElementById("main-content")?.focus();
  }

  async function createDraft(values: ProjectCreateDraft, files: File[] = []) {
    setLastCreated(null);
    setLastCreatedUploadFailures(0);
    setLastDeleted(null);
    const project = await createMutation.mutateAsync(values);
    let uploadFailures = 0;
    for (const file of files) {
      try {
        await uploadReference({ projectId: project.id, file });
      } catch {
        uploadFailures += 1;
      }
    }
    if (files.length > 0)
      void queryClient.invalidateQueries({
        queryKey: projectKeys.detail(project.id),
      });
    setCreateOpenState(false);
    setLastCreated(project);
    setLastCreatedUploadFailures(uploadFailures);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(PROJECT_QUERY_KEYS.SEARCH);
        next.delete(PROJECT_QUERY_KEYS.FILTER);
        next.delete(PROJECT_QUERY_KEYS.SORT);
        next.delete(PROJECT_QUERY_KEYS.SELECTED);
        return next;
      },
      { replace: true },
    );
  }

  function projectDeleted(id: string, name: string) {
    setLastCreated(null);
    setLastCreatedUploadFailures(0);
    setLastDeleted(name);
    if (selectedId !== id) return;
    sheetPushedHistory.current = false;
    projectTriggerRef.current = null;
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete(PROJECT_QUERY_KEYS.SELECTED);
      return next;
    }, { replace: true });
  }

  return {
    projects,
    query,
    filter,
    sort,
    createOpen,
    setCreateOpen,
    selectedId,
    lastCreated,
    lastCreatedUploadFailures,
    lastDeleted,
    projectDeleted,
    // Keep cached details mounted during a background connection failure so
    // an open editor does not lose its unsaved form.
    selectedProject:
      projectQuery.error instanceof ApiError && projectQuery.error.status === 404
        ? undefined
        : projectQuery.data,
    isLoading: projectsQuery.isPending,
    // Failures of "Load more" are reported separately (loadMoreError) so the
    // pages already loaded stay usable.
    isError: projectsQuery.isError && !projectsQuery.isFetchNextPageError,
    hasData: projectsQuery.data !== undefined,
    isFetching: projectsQuery.isFetching,
    retryProjects: () => {
      void projectsQuery.refetch();
    },
    createError: createMutation.isError,
    detailLoading: Boolean(selectedId) && projectQuery.isPending,
    detailMissing:
      projectQuery.error instanceof ApiError &&
      projectQuery.error.status === 404,
    detailError:
      projectQuery.isError &&
      !(
        projectQuery.error instanceof ApiError &&
        projectQuery.error.status === 404
      ),
    detailFetching: projectQuery.isFetching,
    retryProject: () => {
      void projectQuery.refetch();
    },
    // Matching projects across all pages, for "Showing X of Y".
    total: firstPage?.total ?? 0,
    featuredProject: firstPage?.featured ?? undefined,
    counts: firstPage?.counts ?? NO_COUNTS,
    hasMore: projectsQuery.hasNextPage,
    loadMore: () => {
      if (!projectsQuery.isFetching) void projectsQuery.fetchNextPage();
    },
    isLoadingMore: projectsQuery.isFetchingNextPage,
    loadMoreError: projectsQuery.isFetchNextPageError,
    // A new search, filter, or sort is loading while the previous grid stays.
    isUpdating: projectsQuery.isPlaceholderData,
    setQuery: (value: string) =>
      updateParameter(PROJECT_QUERY_KEYS.SEARCH, value),
    setFilter: (value: ProjectFilter) =>
      updateParameter(PROJECT_QUERY_KEYS.FILTER, value, "all"),
    setSort: (value: ProjectSort) =>
      updateParameter(PROJECT_QUERY_KEYS.SORT, value, "updated"),
    clearFilters,
    selectProject,
    closeProject,
    restoreProjectFocus,
    createDraft,
  };
}
