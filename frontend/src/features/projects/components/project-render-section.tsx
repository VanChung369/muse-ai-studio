import { Ban, Clapperboard, Download, LoaderCircle, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { taskErrorKey } from "@/features/tasks/lib/task-format";
import { cn } from "@/lib/utils";
import { useProjectRender } from "../hooks/use-project-render";
import {
  downloadHref,
  needsDuplicateConfirmation,
  renderErrorKey,
  renderFailure,
  renderHeadline,
} from "../lib/project-render";
import type { Project, ProjectRender } from "../types";
import { RenderConfirmDialog } from "./render-confirm-dialog";
import { RenderElapsed } from "./render-elapsed";
import { RenderSceneList, RenderVideo } from "./render-scene-list";

const SEGMENT_CLASSES = {
  queued: "bg-accent",
  running: "relative overflow-hidden bg-running-soft",
  succeeded: "bg-success",
  failed: "bg-destructive",
  interrupted: "bg-destructive",
  cancelled: "bg-surface-4",
} as const;

type Dialog = "start" | "cancel" | "resume" | null;

// Render controls and per-scene results (design boards 13 and 14), sized for
// the project sheet. Hidden until the project has a script.
export function ProjectRenderSection({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { query, refreshProject, start, cancel, resume } = useProjectRender(
    project.id,
  );
  const [dialog, setDialog] = useState<Dialog>(null);
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

  if (project.sceneCount === 0) return null;

  function close() {
    setDialog(null);
    start.reset();
    cancel.reset();
    resume.reset();
  }

  function continueRender(current: ProjectRender) {
    if (needsDuplicateConfirmation(current)) setDialog("resume");
    else resume.mutate({ id: project.id, confirmDuplicate: false });
  }

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
            pending={start.isPending || cancel.isPending || resume.isPending}
            error={
              !dialog && resume.isError
                ? t(renderErrorKey(resume.error))
                : undefined
            }
            onStart={() => setDialog("start")}
            onCancel={() => setDialog("cancel")}
            onResume={() => continueRender(render)}
          />
          {render.videoUrl && (
            <div className="space-y-2">
              <RenderVideo
                src={render.videoUrl}
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
            />
          )}
          <RenderConfirmDialog
            open={dialog === "start"}
            onOpenChange={close}
            title={t("projects.render.start.title", {
              count: render.sceneCount,
            })}
            description={t("projects.render.start.description")}
            dismissLabel={t("projects.render.start.review")}
            confirmLabel={t("projects.render.start.action")}
            pendingLabel={t("projects.render.start.starting")}
            pending={start.isPending}
            error={start.isError ? t(renderErrorKey(start.error)) : undefined}
            onConfirm={() => start.mutate(project.id, { onSuccess: close })}
          >
            <dl className="rounded-lg border bg-card p-3 text-[13px]">
              <dt className="text-xs text-faint">
                {t("projects.render.start.account")}
              </dt>
              <dd className="mt-1">
                {t("projects.render.start.automatic", {
                  count: render.usableAccounts,
                })}
              </dd>
            </dl>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("projects.render.start.locked")}
            </p>
          </RenderConfirmDialog>
          <RenderConfirmDialog
            open={dialog === "cancel"}
            onOpenChange={close}
            title={t("projects.render.cancel.title")}
            description={t("projects.render.cancel.description")}
            dismissLabel={t("projects.render.cancel.keep")}
            confirmLabel={t("projects.render.cancel.action")}
            pendingLabel={t("projects.render.cancel.cancelling")}
            pending={cancel.isPending}
            danger
            error={cancel.isError ? t(renderErrorKey(cancel.error)) : undefined}
            onConfirm={() => cancel.mutate(project.id, { onSuccess: close })}
          />
          <RenderConfirmDialog
            open={dialog === "resume"}
            onOpenChange={close}
            title={t("projects.render.resume.title")}
            description={t("projects.render.resume.description")}
            dismissLabel={t("common.cancel")}
            confirmLabel={t("projects.render.resume.confirm")}
            pendingLabel={t("projects.render.resume.resuming")}
            pending={resume.isPending}
            error={resume.isError ? t(renderErrorKey(resume.error)) : undefined}
            onConfirm={() =>
              resume.mutate(
                { id: project.id, confirmDuplicate: true },
                { onSuccess: close },
              )
            }
          />
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
      {started && (
        // One segment per scene and a last one for the merge; no percentage
        // is shown because Muse does not report one.
        <div className="flex h-1.5 gap-0.5" aria-hidden="true">
          {segments.map((task, index) => (
            <span
              key={index}
              className={cn(
                "flex-1 rounded-xs",
                SEGMENT_CLASSES[task?.status ?? "queued"],
              )}
            >
              {task?.status === "running" && (
                // A bar sliding across the segment being worked on. With reduced
                // motion it fades in place instead, so progress is still visible.
                <span className="absolute inset-y-0 left-0 w-2/5 rounded-xs bg-running motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:animate-pulse" />
              )}
            </span>
          ))}
        </div>
      )}
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
