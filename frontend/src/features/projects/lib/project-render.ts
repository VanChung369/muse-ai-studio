import { ApiError } from "@/lib/http";
import { RENDER_ERROR_CODES } from "../constants";
import type { ProjectRender, ProjectStatus } from "../types";

export function isRenderActive(status: ProjectStatus) {
  return status === "rendering" || status === "cancelling";
}

type RenderScene = ProjectRender["scenes"][number];

/** What the status panel says, with the scene it is about (if any). */
export function renderHeadline(render: ProjectRender) {
  const { scenes, merge, status } = render;
  const scene = (...statuses: string[]): RenderScene | undefined =>
    scenes.find((item) => item.task && statuses.includes(item.task.status));

  if (status === "completed") return { kind: "completed" } as const;
  if (status === "cancelling") return { kind: "cancelling" } as const;
  if (status === "rendering") {
    const running = scene("running");
    if (running) return { kind: "scene", number: running.number } as const;
    if (merge?.status === "running") return { kind: "merging" } as const;
    return { kind: "waiting" } as const;
  }
  if (status === "failed") {
    const failed = scene("failed", "interrupted");
    return failed
      ? ({ kind: "failedScene", number: failed.number } as const)
      : ({ kind: "failedMerge" } as const);
  }
  if (status === "cancelled") {
    const stopped = scene("cancelled");
    return stopped
      ? ({ kind: "cancelledScene", number: stopped.number } as const)
      : ({ kind: "cancelled" } as const);
  }
  return { kind: "notStarted" } as const;
}

/** The task whose error explains why the render stopped. */
export function renderFailure(render: ProjectRender) {
  const tasks = [...render.scenes.map((scene) => scene.task), render.merge];
  return tasks.find(
    (task) => task?.status === "failed" || task?.status === "interrupted",
  );
}

/** A scene interrupted by a restart may already exist on Muse. */
export function needsDuplicateConfirmation(render: ProjectRender) {
  return render.scenes.some((scene) => scene.task?.status === "interrupted");
}

export function downloadHref(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=true`;
}

export function renderErrorKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = RENDER_ERROR_CODES.find((value) => value === code);
  return known
    ? (`projects.render.errors.${known}` as const)
    : "projects.render.errors.unknown";
}
