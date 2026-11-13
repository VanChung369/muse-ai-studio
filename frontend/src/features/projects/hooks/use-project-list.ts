import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { STORAGE_KEYS } from "@/constants/storage";
import { useLanguage } from "@/hooks/use-language";
import { useLocalStorage } from "@/hooks/use-local-storage";

import { PROJECT_QUERY_KEYS } from "../constants";
import { DEMO_PROJECTS } from "../data/demo-projects";
import {
  createProjectDraft,
  getFeaturedProject,
  getProjectCounts,
  getVisibleProjects,
  readDemoProjects,
  resolveProjectFilter,
  resolveProjectSort,
} from "../lib/project-list";
import type {
  Project,
  ProjectDraft,
  ProjectFilter,
  ProjectSort,
} from "../types";

export function useProjectList() {
  const [language] = useLanguage();
  const navigate = useNavigate();
  const [storedProjects, setStoredProjects] = useLocalStorage(
    STORAGE_KEYS.DEMO_PROJECTS,
    DEMO_PROJECTS,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const [createOpen, setCreateOpen] = useState(false);
  const projectTriggerRef = useRef<HTMLElement | null>(null);
  // True when the open sheet added its own history entry, so closing it can
  // step back instead of leaving a duplicate /projects entry behind.
  const sheetPushedHistory = useRef(false);
  const [lastCreated, setLastCreated] = useState<Project | null>(null);
  const projects = readDemoProjects(storedProjects, DEMO_PROJECTS);
  const query = searchParams.get(PROJECT_QUERY_KEYS.SEARCH) ?? "";
  const filter = resolveProjectFilter(
    searchParams.get(PROJECT_QUERY_KEYS.FILTER),
  );
  const sort = resolveProjectSort(searchParams.get(PROJECT_QUERY_KEYS.SORT));
  const selectedId = searchParams.get(PROJECT_QUERY_KEYS.SELECTED);

  useEffect(() => {
    // Browser Back/Forward can close the sheet without closeProject().
    if (!selectedId) sheetPushedHistory.current = false;
  }, [selectedId]);

  function updateParameter(key: string, value: string, defaultValue = "") {
    setLastCreated(null);
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

  function createDraft(values: ProjectDraft) {
    const project = createProjectDraft(values);
    // Keep stored entries as they are, including ones that fail validation,
    // so a schema mismatch never erases earlier drafts.
    setStoredProjects((previous) => [project, ...previous]);
    setCreateOpen(false);
    setLastCreated(project);
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

  return {
    projects,
    query,
    filter,
    sort,
    createOpen,
    setCreateOpen,
    selectedId,
    lastCreated,
    selectedProject: projects.find((project) => project.id === selectedId),
    visibleProjects: getVisibleProjects(
      projects,
      query,
      filter,
      sort,
      language,
    ),
    featuredProject: getFeaturedProject(projects),
    counts: getProjectCounts(projects),
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
