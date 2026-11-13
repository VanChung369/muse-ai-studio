import { useEffect, useState } from "react";

import { needsDuplicateConfirmation } from "../lib/project-render";
import type { Project } from "../types";
import { useProjectRender } from "./use-project-render";

export type RenderDialog = "start" | "cancel" | "resume" | null;

// A project's render status with the actions on it and the confirmation each
// one asks for. Shared by the project sheet and the Render step page; the
// dialogs themselves are drawn by RenderDialogs.
export function useRenderControls(project: Project) {
  const { query, refreshProject, start, cancel, resume, restart } =
    useProjectRender(project.id);
  const [dialog, setDialog] = useState<RenderDialog>(null);
  // The scene a "render again" would start from, while its dialog is open.
  const [restartFrom, setRestartFrom] = useState<number | null>(null);
  const render = query.data;

  // The render endpoint is polled; the project (badge, cards, script lock)
  // is refreshed only when the poll shows it has moved on.
  const stale =
    render !== undefined &&
    (render.status !== project.status ||
      render.completedScenes !== project.completedScenes);
  useEffect(() => {
    if (stale) refreshProject();
    // refreshProject is recreated each render; `stale` alone drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, render?.status, render?.completedScenes]);

  function close() {
    setDialog(null);
    setRestartFrom(null);
    start.reset();
    cancel.reset();
    resume.reset();
    restart.reset();
  }

  // Continues a stopped render; asks first when a scene may already exist.
  function continueRender() {
    if (!render) return;
    if (needsDuplicateConfirmation(render)) setDialog("resume");
    else resume.mutate({ id: project.id, confirmDuplicate: false });
  }

  return {
    query,
    render,
    start,
    cancel,
    resume,
    restart,
    dialog,
    restartFrom,
    pending:
      start.isPending ||
      cancel.isPending ||
      resume.isPending ||
      restart.isPending,
    // A continue that was refused without a dialog to show it in.
    resumeError: !dialog && resume.isError ? resume.error : undefined,
    openStart: () => setDialog("start"),
    openCancel: () => setDialog("cancel"),
    openRestart: setRestartFrom,
    continueRender,
    close,
  };
}

export type RenderControls = ReturnType<typeof useRenderControls>;
