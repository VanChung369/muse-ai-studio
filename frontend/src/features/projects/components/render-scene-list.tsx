import { ChevronDown, Download, RotateCcw } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TaskStatusBadge } from "@/features/tasks/components/task-status-badge";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadHref, isRenderActive } from "../lib/project-render";
import type { Project, ProjectRender } from "../types";
import { RenderElapsed } from "./render-elapsed";

const VIDEO_FRAMES = {
  "16:9": "aspect-video w-full",
  "9:16": "mx-auto aspect-[9/16] max-h-96",
  "1:1": "mx-auto aspect-square max-h-96",
} as const;

export function RenderVideo({
  src,
  aspectRatio,
  label,
}: {
  src: string;
  aspectRatio: Project["aspectRatio"];
  label: string;
}) {
  return (
    <video
      controls
      preload="metadata"
      playsInline
      src={src}
      aria-label={label}
      className={cn("rounded-lg bg-black", VIDEO_FRAMES[aspectRatio])}
    />
  );
}

// One row per scene: status from its render task, and the clip once it exists.
export function RenderSceneList({
  render,
  aspectRatio,
  onRestart,
}: {
  render: ProjectRender;
  aspectRatio: Project["aspectRatio"];
  onRestart: (fromScene: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState<number | null>(null);
  // Only a finished or stopped render can be redone from a scene.
  const canRestart = !isRenderActive(render.status);

  return (
    <ol className="divide-y rounded-lg border bg-card">
      {render.scenes.map((scene) => {
        const { task } = scene;
        const expanded = open === scene.number && scene.videoUrl !== null;
        const running = task?.status === "running";
        const details = [
          formatDuration(scene.durationSeconds),
          task?.accountLabel,
          task && task.attempts > 1
            ? t("projects.render.attempt", { attempts: task.attempts })
            : null,
        ].filter(Boolean);

        return (
          <li
            key={scene.number}
            className={cn(
              "relative overflow-hidden p-3 first:rounded-t-lg last:rounded-b-lg",
              running && "bg-running-soft",
            )}
          >
            {running && (
              // The scene being generated: a bar sliding along its lower edge.
              <span
                className="absolute inset-x-0 bottom-0 h-0.5"
                aria-hidden="true"
              >
                <span className="block h-full w-2/5 bg-running motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:animate-pulse" />
              </span>
            )}
            <div className="flex items-center gap-3">
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-md font-mono text-xs",
                  running
                    ? "bg-running text-background"
                    : "bg-accent text-muted-foreground",
                )}
              >
                {scene.number}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">
                  {scene.title}
                </p>
                <p className="truncate text-xs text-faint">
                  {details.join(" · ")}
                  {running && task.startedAt && (
                    <>
                      {" · "}
                      <RenderElapsed since={task.startedAt} />
                    </>
                  )}
                </p>
              </div>
              {task ? (
                <TaskStatusBadge task={task} />
              ) : (
                <span className="rounded-md border px-2 py-0.5 text-xs whitespace-nowrap text-faint">
                  {t("projects.render.notRendered")}
                </span>
              )}
              {scene.videoUrl && canRestart && (
                <button
                  type="button"
                  title={t("projects.render.restart.action", {
                    number: scene.number,
                  })}
                  aria-label={t("projects.render.restart.action", {
                    number: scene.number,
                  })}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => onRestart(scene.number)}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                </button>
              )}
              {scene.videoUrl && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-label={t(
                    expanded ? "projects.render.hide" : "projects.render.watch",
                    { number: scene.number },
                  )}
                  className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => setOpen(expanded ? null : scene.number)}
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform motion-reduce:transition-none",
                      expanded && "rotate-180",
                    )}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>
            {expanded && scene.videoUrl && (
              <div className="mt-3 space-y-2">
                <RenderVideo
                  src={scene.videoUrl}
                  aspectRatio={aspectRatio}
                  label={scene.title}
                />
                <a
                  href={downloadHref(scene.videoUrl)}
                  download
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover hover:underline"
                >
                  <Download className="size-3.5" aria-hidden="true" />
                  {t("projects.render.downloadScene")}
                </a>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
