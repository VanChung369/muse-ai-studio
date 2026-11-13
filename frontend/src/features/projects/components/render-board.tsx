import {
  Ban,
  CircleAlert,
  Clapperboard,
  Combine,
  Download,
  Info,
  LoaderCircle,
  Play,
  RotateCcw,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { TaskStatusBadge } from "@/features/tasks/components/task-status-badge";
import { taskElapsed, taskErrorKey } from "@/features/tasks/lib/task-format";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  type RenderControls,
  useRenderControls,
} from "../hooks/use-render-controls";
import {
  downloadHref,
  isRenderActive,
  renderErrorKey,
  renderFailure,
  renderHeadline,
} from "../lib/project-render";
import type { Project, ProjectRender } from "../types";
import { RenderDialogs } from "./render-dialogs";
import { RenderElapsed } from "./render-elapsed";
import { RenderProgressBar } from "./render-progress-bar";
import { RenderVideo } from "./render-scene-list";

type RenderScene = ProjectRender["scenes"][number];

const hasStopped = (scene: RenderScene) =>
  scene.task?.status === "failed" || scene.task?.status === "interrupted";

// Step 3 of a project at full width (design board 13): the render's status,
// why it stopped, one row per scene, and the selected scene beside them.
export function RenderBoard({ project }: { project: Project }) {
  const { t } = useTranslation();
  const controls = useRenderControls(project);
  const { query, render } = controls;
  const [chosen, setChosen] = useState<number | null>(null);

  if (!render)
    return query.isError ? (
      <div role="alert" className="space-y-3 p-8">
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
    ) : (
      <PageLoading />
    );

  // Until a scene is picked, follow the one being worked on (or that stopped).
  const selected =
    render.scenes.find((scene) => scene.number === chosen) ??
    render.scenes.find((scene) => scene.task?.status === "running") ??
    render.scenes.find(hasStopped) ??
    render.scenes[0];
  const active = isRenderActive(render.status);
  const stopped = render.status === "failed" || render.status === "cancelled";

  return (
    <div className="grid desktop:grid-cols-[minmax(0,1fr)_23rem]">
      <div className="min-w-0 space-y-4 p-4 tablet:p-6">
        <RenderSummary render={render} controls={controls} />
        {stopped && <StoppedNotice render={render} controls={controls} />}
        <ol
          aria-label={t("projects.details.scenes")}
          className="divide-y overflow-hidden rounded-lg border bg-card"
        >
          {render.scenes.map((scene, index) => (
            <SceneRow
              key={scene.number}
              scene={scene}
              previous={render.scenes[index - 1]}
              selected={scene.number === selected?.number}
              waiting={active}
              canRestart={!active}
              canRetry={stopped}
              pending={controls.pending}
              onSelect={() => setChosen(scene.number)}
              onRestart={() => controls.openRestart(scene.number)}
              onRetry={controls.continueRender}
            />
          ))}
        </ol>
        <p className="text-xs text-faint">{t("projects.render.leaveNote")}</p>
      </div>
      {selected && (
        <aside className="min-w-0 border-t p-5 desktop:border-t-0 desktop:border-l">
          <SceneInspector
            // A new clip or another scene starts the player over.
            key={`${selected.number}:${selected.videoUrl}`}
            scene={selected}
            project={project}
          />
        </aside>
      )}
      <RenderDialogs project={project} render={render} controls={controls} />
    </div>
  );
}

function RenderSummary({
  render,
  controls,
}: {
  render: ProjectRender;
  controls: RenderControls;
}) {
  const { t } = useTranslation();
  const headline = renderHeadline(render);
  const started = render.status !== "ready";
  const active = isRenderActive(render.status);
  const running = [...render.scenes.map((scene) => scene.task), render.merge]
    .filter((task) => task !== null)
    .find((task) => task.status === "running");

  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      {/* Announced only when the headline changes, not on every poll. */}
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
      >
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {active && (
            <LoaderCircle
              className="size-4 shrink-0 self-center text-running motion-safe:animate-spin motion-reduce:animate-pulse"
              aria-hidden="true"
            />
          )}
          {t(`projects.render.headline.${headline.kind}`, {
            number: "number" in headline ? headline.number : undefined,
            count: render.sceneCount,
          })}
        </h2>
        {started && (
          <p className="text-xs text-muted-foreground">
            {t("projects.render.progress", {
              done: render.completedScenes,
              count: render.sceneCount,
            })}
            {running?.startedAt && (
              // Ticks every second: kept out of the announcements.
              <span aria-hidden="true">
                {" · "}
                <RenderElapsed since={running.startedAt} />
              </span>
            )}
          </p>
        )}
      </div>
      {started && <RenderProgressBar render={render} />}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-faint">
        <span>
          {t("projects.workspace.render.sequence", { last: render.sceneCount })}
        </span>
        <span className="flex items-center gap-1.5">
          <Combine className="size-3.5" aria-hidden="true" />
          {t("projects.render.merge")}
        </span>
      </div>
      {!started && render.usableAccounts === 0 && (
        <p className="text-xs leading-5 text-warning">
          {t("projects.render.noAccounts")}
        </p>
      )}
      {(!started || render.status === "rendering") && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!started && (
            <Button
              disabled={controls.pending || render.usableAccounts === 0}
              onClick={controls.openStart}
            >
              <Clapperboard aria-hidden="true" />
              {t("projects.render.start.action")}
            </Button>
          )}
          {render.status === "rendering" && (
            <Button
              variant="destructive"
              disabled={controls.pending}
              onClick={controls.openCancel}
            >
              <Ban aria-hidden="true" />
              {t("projects.render.cancel.action")}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}

// Why the render stopped and how to go on from there.
function StoppedNotice({
  render,
  controls,
}: {
  render: ProjectRender;
  controls: RenderControls;
}) {
  const { t } = useTranslation();
  const failed = render.status === "failed";
  const failure = failed ? renderFailure(render) : undefined;
  const scene = failed ? render.scenes.find(hasStopped) : undefined;
  const nextScene = render.scenes.find((item) => !item.videoUrl);
  const headline = renderHeadline(render);

  return (
    <section
      className={cn(
        "flex gap-3 rounded-lg border p-4",
        failed ? "border-destructive/40 bg-destructive-soft" : "bg-card",
      )}
    >
      {failed ? (
        <CircleAlert
          className="mt-0.5 size-4 shrink-0 text-destructive"
          aria-hidden="true"
        />
      ) : (
        <Ban className="mt-0.5 size-4 shrink-0 text-faint" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold wrap-break-word">
            {scene
              ? t("projects.workspace.render.failedScene", {
                  number: scene.number,
                  title: scene.title,
                })
              : t(`projects.render.headline.${headline.kind}`, {
                  number: "number" in headline ? headline.number : undefined,
                  count: render.sceneCount,
                })}
          </h3>
          <p className="text-[13px] leading-5 text-muted-foreground">
            {failure && `${t(taskErrorKey(failure.error?.code))} `}
            {t("projects.render.kept")}
          </p>
        </div>
        {controls.resumeError && (
          <p role="alert" className="text-xs leading-5 text-destructive">
            {t(renderErrorKey(controls.resumeError))}
          </p>
        )}
        <Button disabled={controls.pending} onClick={controls.continueRender}>
          <Play aria-hidden="true" />
          {nextScene
            ? t("projects.render.resume.fromScene", {
                number: nextScene.number,
              })
            : t("projects.render.resume.action")}
        </Button>
        <p className="text-xs leading-5 text-faint">
          {t("projects.workspace.render.retryNote")}
        </p>
        {failure?.error && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">
              {t("projects.workspace.render.technical")}
            </summary>
            <p className="mt-2 rounded-md bg-background p-3 font-mono leading-5 wrap-break-word whitespace-pre-wrap">
              {failure.error.code}
              {failure.error.message && `\n${failure.error.message}`}
            </p>
          </details>
        )}
      </div>
    </section>
  );
}

function SceneRow({
  scene,
  previous,
  selected,
  waiting,
  canRestart,
  canRetry,
  pending,
  onSelect,
  onRestart,
  onRetry,
}: {
  scene: RenderScene;
  previous?: RenderScene;
  selected: boolean;
  // The render is running, so a queued scene is waiting for its turn.
  waiting: boolean;
  canRestart: boolean;
  canRetry: boolean;
  pending: boolean;
  onSelect: () => void;
  onRestart: () => void;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { task } = scene;
  const running = task?.status === "running";
  const length = formatDuration(scene.durationSeconds);

  // The line under the title: how the scene went, or what it is waiting for.
  let note: React.ReactNode = length;
  if (running && task.startedAt)
    note = (
      <>
        {task.accountLabel && `${task.accountLabel} · `}
        <RenderElapsed since={task.startedAt} />
      </>
    );
  else if (task?.status === "succeeded" && task.finishedAt)
    note = [
      t("projects.workspace.render.processed", { time: taskElapsed(task, 0) }),
      task.accountLabel,
    ]
      .filter(Boolean)
      .join(" · ");
  else if (task && hasStopped(scene))
    note = [
      t(taskErrorKey(task.error?.code)),
      task.attempts > 1 &&
        t("projects.render.attempt", { attempts: task.attempts }),
    ]
      .filter(Boolean)
      .join(" · ");
  else if (waiting && task?.status === "queued" && previous && !previous.videoUrl)
    note = t("projects.workspace.render.waitsFor", { number: previous.number });

  return (
    <li
      className={cn(
        "relative flex flex-wrap items-center gap-x-4 gap-y-2 p-3",
        selected && "bg-secondary",
        running && "bg-running-soft",
      )}
    >
      {running && (
        // The scene being generated: a bar sliding along its lower edge.
        <span className="absolute inset-x-0 bottom-0 h-0.5" aria-hidden="true">
          <span className="block h-full w-2/5 bg-running motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:animate-pulse" />
        </span>
      )}
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className="flex min-w-0 flex-1 basis-64 items-center gap-4 rounded-md text-left"
      >
        <span className="w-5 shrink-0 font-mono text-xs text-faint">
          {String(scene.number).padStart(2, "0")}
        </span>
        <span className="relative h-14 w-24 shrink-0 overflow-hidden rounded-md border bg-background">
          {scene.thumbnailUrl && (
            <img
              src={scene.thumbnailUrl}
              alt=""
              loading="lazy"
              className="size-full object-cover"
            />
          )}
          {scene.videoUrl && (
            <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
              {length}
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {scene.title}
          </span>
          <span className="block truncate text-xs text-faint">{note}</span>
        </span>
      </button>
      {task ? (
        <TaskStatusBadge task={task} />
      ) : (
        <span className="rounded-md border px-2 py-0.5 text-xs whitespace-nowrap text-faint">
          {t("projects.render.notRendered")}
        </span>
      )}
      {/* A fixed column, so the badges line up whether a row has an action. */}
      <span className="flex w-44 shrink-0 justify-end">
        {scene.videoUrl && canRestart && (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            aria-label={t("projects.render.restart.action", {
              number: scene.number,
            })}
            onClick={onRestart}
          >
            <RotateCcw aria-hidden="true" />
            {t("projects.workspace.render.restartHere")}
          </Button>
        )}
        {!scene.videoUrl && canRetry && hasStopped(scene) && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={onRetry}
          >
            <RotateCcw aria-hidden="true" />
            {t("common.retry")}
          </Button>
        )}
      </span>
    </li>
  );
}

// The selected scene: its clip, what was asked for, and how the render went.
function SceneInspector({
  scene,
  project,
}: {
  scene: RenderScene;
  project: Project;
}) {
  const { t } = useTranslation();
  const { task } = scene;
  const prompt = project.scenes.find(
    (item) => item.number === scene.number,
  )?.prompt;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {t("projects.workspace.render.sceneHeading", {
            number: scene.number,
            title: scene.title,
          })}
        </h2>
        {task && <TaskStatusBadge task={task} />}
      </div>
      {scene.videoUrl ? (
        <RenderVideo
          src={scene.videoUrl}
          poster={scene.thumbnailUrl}
          muted={project.mute}
          aspectRatio={project.aspectRatio}
          label={scene.title}
        />
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-input px-4 text-center">
          <p className="text-[13px] text-muted-foreground">
            {t("projects.workspace.render.noResult")}
          </p>
        </div>
      )}
      {prompt && (
        <p className="max-h-48 overflow-y-auto text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground">
          {prompt}
        </p>
      )}
      <dl className="divide-y border-y text-[13px]">
        {(
          [
            ["attempts", task && task.attempts > 0 ? task.attempts : null],
            ["account", task?.accountLabel],
            [
              "processingTime",
              // Only a finished scene has a time worth reading.
              task?.status === "succeeded" && task.finishedAt
                ? taskElapsed(task, 0)
                : null,
            ],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="flex items-center justify-between gap-3 py-2.5">
            <dt className="text-muted-foreground">
              {t(`projects.workspace.render.${key}`)}
            </dt>
            <dd className="min-w-0 truncate font-mono text-xs">
              {value ?? "—"}
            </dd>
          </div>
        ))}
      </dl>
      {scene.videoUrl && (
        <a
          href={downloadHref(scene.videoUrl)}
          download
          className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary-hover hover:underline"
        >
          <Download className="size-3.5" aria-hidden="true" />
          {t("projects.render.downloadScene")}
        </a>
      )}
      <p className="flex gap-2.5 rounded-lg border bg-card p-3 text-xs leading-5 text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {t("projects.workspace.render.restartNote")}
      </p>
    </div>
  );
}
