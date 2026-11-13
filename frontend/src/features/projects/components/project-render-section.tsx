import { Ban, Clapperboard, Download, LoaderCircle, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { taskErrorKey } from "@/features/tasks/lib/task-format";
import { useRenderControls } from "../hooks/use-render-controls";
import {
  downloadHref,
  renderErrorKey,
  renderFailure,
  renderHeadline,
} from "../lib/project-render";
import type { Project, ProjectRender } from "../types";
import { RenderDialogs } from "./render-dialogs";
import { RenderElapsed } from "./render-elapsed";
import { RenderProgressBar } from "./render-progress-bar";
import { RenderSceneList, RenderVideo } from "./render-scene-list";

// Render controls and per-scene results (design boards 13 and 14), sized for
// the project sheet. Hidden until the project has a script. The Render step
// page shows the same render at full width (RenderBoard).
export function ProjectRenderSection({ project }: { project: Project }) {
  const { t } = useTranslation();
  const controls = useRenderControls(project);
  const { query, render } = controls;

  if (project.sceneCount === 0) return null;

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{t("projects.render.title")}</h3>
      {query.isError && !render && (
        <div role="alert" className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            {t("projects.render.loadError")}
          </p>
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {render && (
        <>
          <RenderStatusPanel
            render={render}
            pending={controls.pending}
            error={
              controls.resumeError
                ? t(renderErrorKey(controls.resumeError))
                : undefined
            }
            onStart={controls.openStart}
            onCancel={controls.openCancel}
            onResume={controls.continueRender}
          />
          {render.videoUrl && (
            <div className="space-y-2">
              <RenderVideo
                src={render.videoUrl}
                poster={project.coverUrl}
                aspectRatio={project.aspectRatio}
                label={t("projects.render.finalVideo")}
              />
              <Button variant="outline" asChild>
                <a href={downloadHref(render.videoUrl)} download>
                  <Download aria-hidden="true" />
                  {t("projects.render.downloadVideo")}
                </a>
              </Button>
            </div>
          )}
          {render.status !== "ready" && (
            <RenderSceneList
              render={render}
              aspectRatio={project.aspectRatio}
              muted={project.mute}
              onRestart={controls.openRestart}
            />
          )}
          <RenderDialogs project={project} render={render} controls={controls} />
        </>
      )}
    </section>
  );
}

function RenderStatusPanel({
  render,
  pending,
  error,
  onStart,
  onCancel,
  onResume,
}: {
  render: ProjectRender;
  pending: boolean;
  error?: string;
  onStart: () => void;
  onCancel: () => void;
  onResume: () => void;
}) {
  const { t } = useTranslation();
  const headline = renderHeadline(render);
  const failure = renderFailure(render);
  const started = render.status !== "ready";
  const stopped = render.status === "failed" || render.status === "cancelled";
  const nextScene = render.scenes.find((scene) => !scene.videoUrl);
  const segments = [...render.scenes.map((scene) => scene.task), render.merge];
  const active =
    render.status === "rendering" || render.status === "cancelling";
  const running = segments.find((task) => task?.status === "running");

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {/* Announced only when the headline changes, not on every poll. */}
      <div role="status" aria-live="polite">
        <p className="flex items-center gap-2 text-sm font-semibold">
          {active && (
            <LoaderCircle
              className="size-4 shrink-0 text-running motion-safe:animate-spin motion-reduce:animate-pulse"
              aria-hidden="true"
            />
          )}
          {t(`projects.render.headline.${headline.kind}`, {
            number: "number" in headline ? headline.number : undefined,
            count: render.sceneCount,
          })}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {started
            ? t("projects.render.progress", {
                done: render.completedScenes,
                count: render.sceneCount,
              })
            : t("projects.render.order")}
          {running?.startedAt && (
            // Ticks every second: kept out of the announcements.
            <span aria-hidden="true">
              {" · "}
              <RenderElapsed since={running.startedAt} />
            </span>
          )}
        </p>
      </div>
      {started && <RenderProgressBar render={render} />}
      {render.status === "failed" && failure && (
        <p className="text-xs leading-5 text-destructive">
          {t(taskErrorKey(failure.error?.code))} {t("projects.render.kept")}
        </p>
      )}
      {render.status === "cancelled" && (
        <p className="text-xs leading-5 text-muted-foreground">
          {t("projects.render.kept")}
        </p>
      )}
      {!started && render.usableAccounts === 0 && (
        <p className="text-xs leading-5 text-warning">
          {t("projects.render.noAccounts")}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-5 text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!started && (
          <Button
            disabled={pending || render.usableAccounts === 0}
            onClick={onStart}
          >
            <Clapperboard aria-hidden="true" />
            {t("projects.render.start.action")}
          </Button>
        )}
        {render.status === "rendering" && (
          <Button variant="destructive" disabled={pending} onClick={onCancel}>
            <Ban aria-hidden="true" />
            {t("projects.render.cancel.action")}
          </Button>
        )}
        {stopped && (
          <Button disabled={pending} onClick={onResume}>
            <Play aria-hidden="true" />
            {nextScene
              ? t("projects.render.resume.fromScene", {
                  number: nextScene.number,
                })
              : t("projects.render.resume.action")}
          </Button>
        )}
      </div>
      {(render.status === "rendering" || render.status === "cancelling") && (
        <p className="text-xs text-faint">{t("projects.render.leaveNote")}</p>
      )}
    </div>
  );
}
