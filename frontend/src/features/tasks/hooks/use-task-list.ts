import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { TASK_QUERY_PARAMS } from "../constants";
import { resolveTaskFilter } from "../lib/task-format";
import type { TaskFilter, TaskAction } from "../types";
import { useTasksQuery } from "./use-task-queries";

export function useTaskList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const filter = resolveTaskFilter(params.get(TASK_QUERY_PARAMS.STATUS));
  const projectId = params.get(TASK_QUERY_PARAMS.PROJECT) || null;
  const selectedId = params.get(TASK_QUERY_PARAMS.SELECTED);
  const query = useTasksQuery({ status: filter, projectId });
  const trigger = useRef<HTMLElement | null>(null);
  const pushed = useRef(false);
  const pendingPageFocus = useRef<{
    known: Set<string>;
    trigger: Element | null;
  } | null>(null);
  const [requestedAction, setRequestedAction] = useState<{
    id: string;
    action: TaskAction;
  } | null>(null);
  const seen = new Set<string>();
  const tasks = (query.data?.pages ?? [])
    .flatMap((page) => page.items)
    .filter((task) => !seen.has(task.id) && seen.add(task.id));

  useEffect(() => {
    if (!selectedId) pushed.current = false;
  }, [selectedId]);

  useEffect(() => {
    const pending = pendingPageFocus.current;
    if (!pending || query.isFetchingNextPage) return;
    pendingPageFocus.current = null;
    const firstNew = tasks.find((task) => !pending.known.has(task.id));
    if (
      firstNew &&
      (document.activeElement === pending.trigger ||
        !pending.trigger?.isConnected)
    ) {
      document
        .querySelector<HTMLButtonElement>(
          `[data-task-id="${CSS.escape(firstNew.id)}"] button`,
        )
        ?.focus();
    }
  }, [query.isFetchingNextPage, query.dataUpdatedAt, tasks]);

  function loadMore() {
    if (query.isFetching) return;
    pendingPageFocus.current = {
      known: new Set(tasks.map((task) => task.id)),
      trigger: document.activeElement,
    };
    void query.fetchNextPage();
  }

  function setFilter(value: TaskFilter) {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === "all") next.delete(TASK_QUERY_PARAMS.STATUS);
        else next.set(TASK_QUERY_PARAMS.STATUS, value);
        return next;
      },
      { replace: true },
    );
  }

  function clearProject() {
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(TASK_QUERY_PARAMS.PROJECT);
        return next;
      },
      { replace: true },
    );
  }

  function select(id: string) {
    setRequestedAction(null);
    open(id);
  }

  function selectAction(id: string, action: TaskAction) {
    setRequestedAction({ id, action });
    open(id);
  }

  function open(id: string) {
    trigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    pushed.current = true;
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set(TASK_QUERY_PARAMS.SELECTED, id);
      return next;
    });
  }

  function close() {
    setRequestedAction(null);
    if (pushed.current) {
      pushed.current = false;
      navigate(-1);
      return;
    }
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(TASK_QUERY_PARAMS.SELECTED);
        return next;
      },
      { replace: true },
    );
  }

  function restoreFocus(event: Event) {
    event.preventDefault();
    const previous = trigger.current;
    if (previous?.isConnected) {
      // Stopping work disables its row button. Return to the task title when
      // the original control can no longer receive focus.
      const target =
        previous instanceof HTMLButtonElement && previous.disabled
          ? previous
              .closest("[data-task-id]")
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
          : previous;
      if (target) {
        target.focus();
        return;
      }
    }
    document.getElementById("main-content")?.focus();
  }

  return {
    query,
    tasks,
    filter,
    projectId,
    selectedId,
    setFilter,
    clearProject,
    select,
    selectAction,
    initialAction:
      requestedAction?.id === selectedId ? requestedAction.action : null,
    close,
    restoreFocus,
    loadMore,
  };
}
