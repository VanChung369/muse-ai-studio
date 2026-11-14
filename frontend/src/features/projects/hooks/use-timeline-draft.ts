import { useEffect, useRef, useState } from "react";

import {
  draftOf,
  followClips,
  type TimelineDraft,
  timelinePayload,
} from "../lib/project-timeline";
import type { ProjectTimeline } from "../types";

// Steps kept for undo.
const HISTORY = 100;
// Changes of one kind this close together are one step (a drag, a slider).
const MERGE_MS = 800;

const storageKey = (projectId: string) => `muse.timeline-draft.${projectId}`;
const stamp = (draft: TimelineDraft) => JSON.stringify(timelinePayload(draft));

type Stored = { base: string; draft: TimelineDraft };

function readStored(projectId: string, base: string): TimelineDraft | null {
  try {
    const raw = sessionStorage.getItem(storageKey(projectId));
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored;
    // Made on another saved edit (the film was merged since): no longer fits.
    return stored.base === base ? stored.draft : null;
  } catch {
    return null;
  }
}

function writeStored(projectId: string, stored: Stored | null) {
  try {
    if (stored)
      sessionStorage.setItem(storageKey(projectId), JSON.stringify(stored));
    else sessionStorage.removeItem(storageKey(projectId));
  } catch {
    // Storage can be full or switched off; the draft then lives in memory only.
  }
}

/**
 * The film's edit while it is being changed: the draft, undo and redo, and a
 * copy kept for this browser tab so that leaving the page (or reloading it)
 * does not lose changes that were not applied yet.
 *
 * Mount it afresh whenever the saved timeline changes (a `key` on the
 * component that calls it).
 */
export function useTimelineDraft(
  projectId: string,
  timeline: ProjectTimeline | undefined,
) {
  const saved = draftOf(timeline);
  const base = stamp(saved);
  const [state, setState] = useState(() => {
    const stored = timeline ? readStored(projectId, base) : null;
    return {
      draft: stored ?? saved,
      past: [] as TimelineDraft[],
      future: [] as TimelineDraft[],
      // Changes from an earlier visit were brought back.
      restored: stored !== null && stamp(stored) !== base,
    };
  });
  // Captions and titles stay on the clip they were on when clips move.
  const [follow, setFollow] = useState(true);
  // What the last change was and when, to fold a drag into one undo step.
  const last = useRef({ label: "", at: 0 });

  const { draft } = state;
  const dirty = timeline !== undefined && stamp(draft) !== base;

  useEffect(() => {
    if (timeline === undefined) return;
    writeStored(projectId, dirty ? { base, draft } : null);
  }, [projectId, timeline, dirty, base, draft]);

  // Closing or reloading the tab asks first while changes are not applied.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  /**
   * Applies a change as one undo step. Changes given the same `label` in
   * quick succession (every tick of a drag) count as a single step.
   */
  function change(
    edit: (draft: TimelineDraft) => TimelineDraft,
    label = "",
  ) {
    const now = Date.now();
    const merged =
      label !== "" &&
      last.current.label === label &&
      now - last.current.at < MERGE_MS;
    last.current = { label, at: now };
    setState((current) => {
      let next = edit(current.draft);
      if (next === current.draft) return current;
      if (follow && next.items !== current.draft.items)
        next = {
          ...next,
          captions: followClips(next.captions, current.draft.items, next.items),
          titles: followClips(next.titles, current.draft.items, next.items),
        };
      return {
        ...current,
        draft: next,
        past: merged
          ? current.past
          : [...current.past.slice(-(HISTORY - 1)), current.draft],
        future: [],
      };
    });
  }

  function undo() {
    last.current = { label: "", at: 0 };
    setState((current) => {
      const previous = current.past.at(-1);
      return previous
        ? {
            ...current,
            draft: previous,
            past: current.past.slice(0, -1),
            future: [current.draft, ...current.future],
          }
        : current;
    });
  }

  function redo() {
    last.current = { label: "", at: 0 };
    setState((current) => {
      const [next, ...rest] = current.future;
      return next
        ? {
            ...current,
            draft: next,
            past: [...current.past, current.draft],
            future: rest,
          }
        : current;
    });
  }

  /** Back to the saved edit; still one step, so it can be undone. */
  function reset() {
    last.current = { label: "", at: 0 };
    // Not through `change`: the saved captions and titles go back exactly
    // where they were, rather than following the clips once more.
    setState((current) =>
      stamp(current.draft) === base
        ? { ...current, restored: false }
        : {
            draft: saved,
            past: [...current.past.slice(-(HISTORY - 1)), current.draft],
            future: [],
            restored: false,
          },
    );
  }

  return {
    draft,
    saved,
    dirty,
    restored: state.restored && dirty,
    change,
    undo,
    redo,
    reset,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    follow,
    setFollow,
  };
}
