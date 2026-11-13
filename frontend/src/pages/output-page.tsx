import {
  Captions,
  Download,
  EyeOff,
  FileText,
  Film,
  Layers,
  LoaderCircle,
  Music,
  Pencil,
  Terminal,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router";

import { Button } from "@/components/ui/button";
import {
  TimelineCutEditor,
  TimelineStrip,
} from "@/features/projects/components/studio-timeline";
import { useProjectRender } from "@/features/projects/hooks/use-project-render";
import { useProjectTimeline } from "@/features/projects/hooks/use-project-timeline";
import { projectStepHref } from "@/features/projects/lib/project-list";
import {
  downloadText,
  filmSegments,
  promptsJson,
  rulerMarks,
  scriptMarkdown,
  segmentAt,
} from "@/features/projects/lib/project-output";
import {
  downloadHref,
  isRenderActive,
} from "@/features/projects/lib/project-render";
import {
  isTimelineValid,
  moveItem,
  timelineCuts,
  timelineErrorKey,
  timelineSeconds,
} from "@/features/projects/lib/project-timeline";
import type {
  Project,
  ProjectRender,
  ProjectTimeline,
  TimelineItem,
} from "@/features/projects/types";
import { useLanguage } from "@/hooks/use-language";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

const VIDEO_FRAMES = {
  "16:9": "aspect-video w-full",
  "9:16": "mx-auto aspect-[9/16] max-h-[70svh]",
  "1:1": "mx-auto aspect-square max-h-[70svh]",
} as const;

// Step 4 of a project, "Thành phẩm" (design board 14): the finished film,
// its scenes, downloads and exports, and the timeline that decides how the
// scenes are joined.
export function OutputPage() {
  const project = useOutletContext<Project>();
  const render = useProjectRender(project.id);
  const timeline = useProjectTimeline(project.id);

  return (
    <Output
      // The draft starts over from whatever the server now holds.
      key={JSON.stringify(timeline.query.data?.items ?? null)}
      project={project}
      render={render.query.data}
      timeline={timeline.query.data}
      save={timeline.save}
      refreshProject={render.refreshProject}
    />
  );
}

function Output({
  project,
  render,
  timeline,
  save,
  refreshProject,
}: {
  project: Project;
  render: ProjectRender | undefined;
  timeline: ProjectTimeline | undefined;
  save: ReturnType<typeof useProjectTimeline>["save"];
  refreshProject: () => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  // The render is polled; the project (status, cover, length) is fetched
  // again only when the poll shows it has moved on, e.g. a merge finished.
  const stale = render !== undefined && render.status !== project.status;
  useEffect(() => {
    if (stale) refreshProject();
    // refreshProject is recreated each render; `stale` alone drives this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stale, render?.status]);
  const film = useRef<HTMLVideoElement>(null);
  const clip = useRef<HTMLVideoElement>(null);
  // The film's edit as it is being changed; saved ones come from the server.
  const [draft, setDraft] = useState<TimelineItem[]>(timeline?.items ?? []);
  // The scene being trimmed; null shows the whole film.
  const [editing, setEditing] = useState<number | null>(null);
  const [time, setTime] = useState(0);

  const saved = filmSegments(timeline?.items ?? []);
  const total = timelineSeconds(draft);
  const cutIndex = draft.findIndex((item) => item.scene === editing);
  const cut = cutIndex >= 0 ? draft[cutIndex] : undefined;
  const merging = timeline ? isRenderActive(timeline.status) : false;
  const editable = Boolean(timeline?.editable) && !save.isPending;
  const dirty =
    timeline !== undefined &&
    JSON.stringify(timelineCuts(draft)) !==
      JSON.stringify(timelineCuts(timeline.items));
  const current = saved.length ? segmentAt(saved, time) : undefined;
  const videoUrl = render?.videoUrl ?? null;
  const finished = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(project.updatedAt));

  function seek(seconds: number) {
    setEditing(null);
    setTime(seconds);
    // The film player mounts after `editing` clears; seek once it is there.
    requestAnimationFrame(() => {
      if (!film.current) return;
      film.current.currentTime = seconds;
      void film.current.play().catch(() => undefined);
    });
  }

  function move(from: number, to: number) {
    setDraft((items) => moveItem(items, from, to));
  }

  // The video track holds the scenes that are in the film, so it lines up
  // with the ruler; scenes left out wait in their own row.
  const kept = draft.filter((item) => item.enabled);
  const leftOut = draft.filter((item) => !item.enabled);
  const indexOf = (item: TimelineItem) => draft.indexOf(item);
  // Seconds the full track width stands for: the kept scenes untrimmed, so
  // the scale holds still while a clip is trimmed.
  const span = Math.max(
    kept.reduce((sum, item) => sum + item.clipSeconds, 0),
    0.1,
  );

  function trimScene(scene: number, edge: "start" | "end", seconds: number) {
    setDraft((items) =>
      items.map((item) =>
        item.scene === scene ? { ...item, [edge]: seconds } : item,
      ),
    );
    // Show the frame the cut now lands on, as an editor does while trimming.
    if (clip.current) {
      clip.current.pause();
      clip.current.currentTime = edge === "end" ? Math.max(seconds - 0.05, 0) : seconds;
    }
  }

  return (
    <>
      <div className="grid desktop:grid-cols-[minmax(0,1fr)_23.75rem]">
        <section className="min-w-0 space-y-5 p-4 tablet:p-6">
          <div className="relative overflow-hidden rounded-lg bg-black">
            {cut ? (
              <video
                ref={clip}
                key={cut.scene}
                controls
                playsInline
                preload="auto"
                muted={project.mute}
                // The address stays the same while the cut is trimmed, so the
                // clip is not loaded again; it opens on the kept part and
                // playback is held inside it below.
                src={cut.videoUrl}
                onLoadedMetadata={(event) => {
                  event.currentTarget.currentTime = cut.start;
                }}
                onPlay={(event) => {
                  const player = event.currentTarget;
                  if (
                    player.currentTime < cut.start ||
                    player.currentTime >= cut.end - 0.05
                  )
                    player.currentTime = cut.start;
                }}
                onTimeUpdate={(event) => {
                  const player = event.currentTarget;
                  if (!player.paused && player.currentTime >= cut.end)
                    player.pause();
                }}
                className={VIDEO_FRAMES[project.aspectRatio]}
              />
            ) : videoUrl ? (
              <video
                ref={film}
                key={videoUrl}
                controls
                playsInline
                preload="metadata"
                muted={project.mute}
                poster={project.coverUrl ?? undefined}
                src={videoUrl}
                onTimeUpdate={(event) =>
                  setTime(event.currentTarget.currentTime)
                }
                className={VIDEO_FRAMES[project.aspectRatio]}
              />
            ) : (
              <div className="grid aspect-video place-items-center px-6 text-center text-sm text-muted-foreground">
                {t(
                  merging
                    ? "projects.timeline.merging"
                    : "projects.output.notReady",
                )}
              </div>
            )}
            {(cut ?? current) && (
              <span className="pointer-events-none absolute top-3 left-3 rounded-md bg-black/70 px-2 py-1 text-xs text-white">
                {t("projects.details.scene", {
                  number: (cut ?? current)!.scene,
                })}{" "}
                · {(cut ?? current)!.title}
              </span>
            )}
          </div>
          {cut && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {t("projects.output.previewing", { number: cut.scene })}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditing(null)}
              >
                <Film aria-hidden="true" />
                {t("projects.output.watchFilm")}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {t("projects.sceneCount", { count: draft.length })}
            </h2>
            <p className="text-xs text-faint">
              {t("projects.output.sceneHint")}
            </p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {(timeline?.items ?? []).map((item) => {
              const segment = saved.find((entry) => entry.scene === item.scene);
              return (
                <li key={item.scene} className="min-w-0 space-y-1.5">
                  <button
                    type="button"
                    aria-label={t("projects.output.jumpTo", {
                      number: item.scene,
                    })}
                    aria-current={
                      !cut && current?.scene === item.scene ? "true" : undefined
                    }
                    // A scene left out of the film has no place to jump to:
                    // open it for editing instead.
                    onClick={() =>
                      segment ? seek(segment.offset) : setEditing(item.scene)
                    }
                    className={cn(
                      "relative block aspect-video w-full overflow-hidden rounded-lg bg-background",
                      !cut &&
                        current?.scene === item.scene &&
                        "ring-2 ring-primary",
                      !item.enabled && "opacity-45",
                    )}
                  >
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                    <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 font-mono text-[10px] leading-4 text-white">
                      {String(item.scene).padStart(2, "0")}
                    </span>
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 font-mono text-[10px] leading-4 text-white">
                      {item.enabled
                        ? `${(item.end - item.start).toFixed(1)}s`
                        : t("projects.timeline.excluded")}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {item.title}
                    </span>
                    <a
                      href={downloadHref(item.videoUrl)}
                      download
                      aria-label={t("projects.output.downloadScene", {
                        number: item.scene,
                      })}
                      className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                    >
                      <Download className="size-3.5" aria-hidden="true" />
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="min-w-0 divide-y border-t desktop:border-t-0 desktop:border-l">
          <section className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">
              {t("projects.output.info")}
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
              <dt className="text-muted-foreground">
                {t("projects.details.duration")}
              </dt>
              <dd className="font-mono">
                {formatDuration(
                  Math.round(timeline?.totalSeconds ?? project.durationSeconds),
                )}
              </dd>
              <dt className="text-muted-foreground">
                {t("projects.details.ratio")}
              </dt>
              <dd>{project.aspectRatio}</dd>
              <dt className="text-muted-foreground">
                {t("projects.details.scenes")}
              </dt>
              <dd>
                {t("projects.output.scenesInFilm", {
                  kept: saved.length,
                  count: project.sceneCount,
                })}
              </dd>
              <dt className="text-muted-foreground">
                {t("projects.details.updated")}
              </dt>
              <dd>{finished}</dd>
            </dl>
          </section>
          <section className="space-y-2 p-5">
            <h2 className="text-sm font-semibold">
              {t("projects.output.downloads")}
            </h2>
            {videoUrl && (
              <FileButton
                icon={Film}
                label={t("projects.output.fullVideo")}
                detail="MP4"
                href={downloadHref(videoUrl)}
              />
            )}
            {draft.length > 0 && (
              <FileButton
                icon={Layers}
                label={t("projects.output.allScenes")}
                detail={t("projects.output.files", { count: draft.length })}
                href={`/api/projects/${encodeURIComponent(project.id)}/scenes.zip`}
              />
            )}
            <h2 className="pt-2 text-sm font-semibold">
              {t("projects.output.export")}
            </h2>
            <FileButton
              icon={FileText}
              label={t("projects.output.script")}
              detail=".md"
              onClick={() =>
                downloadText(
                  project,
                  "md",
                  scriptMarkdown(project, {
                    idea: t("projects.details.idea"),
                    characters: t("projects.form.characters"),
                    visualStyle: t("projects.settings.look"),
                    scene: (number) => t("projects.details.scene", { number }),
                    narration: t("projects.script.narration"),
                  }),
                  "text/markdown",
                )
              }
            />
            <FileButton
              icon={Terminal}
              label={t("projects.output.prompts")}
              detail=".json"
              onClick={() =>
                downloadText(
                  project,
                  "prompts.json",
                  promptsJson(project),
                  "application/json",
                )
              }
            />
            <p className="text-xs leading-5 text-faint">
              {t("projects.output.exportNote")}
            </p>
          </section>
          <section className="space-y-3 p-5">
            <h2 className="text-sm font-semibold">
              {t("projects.output.edit")}
            </h2>
            <p className="text-[13px] leading-6 text-muted-foreground">
              {t("projects.output.editNote")}
            </p>
            <Button variant="outline" asChild>
              <Link to={projectStepHref(project.id, "script")}>
                <Pencil aria-hidden="true" />
                {t("projects.output.openScript")}
              </Link>
            </Button>
          </section>
        </aside>
      </div>

      {draft.length > 0 && (
        <section
          aria-label={t("projects.timeline.title")}
          className="space-y-3 border-t bg-card p-4 tablet:px-6"
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-sm font-semibold">
              {t("projects.timeline.title")}
            </h2>
            <p className="font-mono text-xs text-muted-foreground">
              {t("projects.timeline.total", { time: `${total.toFixed(1)}s` })}
            </p>
            {merging && (
              <p
                role="status"
                className="flex items-center gap-1.5 text-xs text-running"
              >
                <LoaderCircle
                  className="size-3.5 motion-safe:animate-spin motion-reduce:animate-pulse"
                  aria-hidden="true"
                />
                {t("projects.timeline.merging")}
              </p>
            )}
            <div className="ml-auto flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  save.reset();
                  setDraft(timeline?.items ?? []);
                }}
              >
                {t("projects.timeline.reset")}
              </Button>
              <Button
                disabled={!editable || !dirty || !isTimelineValid(draft)}
                onClick={() =>
                  save.mutate({ id: project.id, items: timelineCuts(draft) })
                }
              >
                {t(
                  save.isPending
                    ? "projects.timeline.applying"
                    : "projects.timeline.apply",
                )}
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5">
            <span />
            {/* Seconds along the film; click to jump there. */}
            <div
              className={cn(
                "relative h-5 border-b border-input font-mono text-[10px] text-faint",
                videoUrl && !dirty && "cursor-pointer",
              )}
              onClick={(event) => {
                if (!videoUrl || dirty || total <= 0) return;
                const box = event.currentTarget.getBoundingClientRect();
                seek(
                  Math.min(
                    ((event.clientX - box.left) / box.width) * span,
                    total,
                  ),
                );
              }}
            >
              {/* A mark at the very end would run off the track. */}
              {rulerMarks(span)
                .filter((mark) => mark < span * 0.97)
                .map((mark) => (
                  <span
                    key={mark}
                    style={{ left: `${(mark / span) * 100}%` }}
                    className="absolute bottom-0 border-l border-input pl-1 leading-4"
                  >
                    {formatDuration(mark)}
                  </span>
                ))}
            </div>

            <TrackLabel icon={Film}>
              {t("projects.output.tracks.video")}
            </TrackLabel>
            <div className="relative">
              <TimelineStrip
                items={kept}
                selected={editing}
                editable={editable}
                onSelect={setEditing}
                span={span}
                onMove={(from, to) =>
                  move(indexOf(kept[from]), indexOf(kept[to]))
                }
                onTrim={trimScene}
              />
              {/* Where the film is playing. Only meaningful for the saved cut. */}
              {!cut && !dirty && videoUrl && total > 0 && (
                <span
                  aria-hidden="true"
                  style={{ left: `${Math.min(time / span, 1) * 100}%` }}
                  className="pointer-events-none absolute -top-6 bottom-0 w-px bg-primary"
                />
              )}
            </div>

            {leftOut.length > 0 && (
              <>
                <TrackLabel icon={EyeOff}>
                  {t("projects.timeline.excluded")}
                </TrackLabel>
                <ul className="flex flex-wrap gap-1.5">
                  {leftOut.map((item) => (
                    <li key={item.scene}>
                      <button
                        type="button"
                        aria-pressed={editing === item.scene}
                        onClick={() => setEditing(item.scene)}
                        className={cn(
                          "flex h-8 items-center gap-2 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground",
                          editing === item.scene
                            ? "border-primary"
                            : "border-input",
                        )}
                      >
                        <span className="font-mono text-[10px]">
                          {item.scene}
                        </span>
                        <span className="max-w-40 truncate">{item.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {/* Not built yet: shown so the editor's direction is clear. */}
            <TrackLabel icon={Music}>
              {t("projects.output.tracks.music")}
            </TrackLabel>
            <PlannedTrack>{t("projects.output.soon")}</PlannedTrack>
            <TrackLabel icon={Captions}>
              {t("projects.output.tracks.subtitles")}
            </TrackLabel>
            <PlannedTrack>{t("projects.output.soon")}</PlannedTrack>
          </div>

          {/* Under the tracks, so selecting a clip never moves them. */}
          {cut && (
            <div className="max-w-md rounded-lg border p-4">
              <TimelineCutEditor
                item={cut}
                index={cutIndex}
                count={draft.length}
                editable={editable}
                onChange={(patch) =>
                  setDraft((items) =>
                    items.map((item) =>
                      item.scene === cut.scene ? { ...item, ...patch } : item,
                    ),
                  )
                }
                onMove={move}
              />
            </div>
          )}
          {save.isError && (
            <p role="alert" className="text-xs text-destructive">
              {t(timelineErrorKey(save.error))}
            </p>
          )}
          <p className="text-xs leading-5 text-faint">
            {t(
              timeline?.editable || merging
                ? "projects.timeline.hint"
                : "projects.timeline.locked",
            )}
          </p>
        </section>
      )}
    </>
  );
}

function FileButton({
  icon: Icon,
  label,
  detail,
  href,
  onClick,
}: {
  icon: typeof Film;
  label: string;
  detail: string;
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className="truncate">{label}</span>
      </span>
      <span className="shrink-0 text-xs font-normal text-faint">{detail}</span>
    </>
  );
  return href ? (
    <Button variant="outline" className="w-full justify-between" asChild>
      <a href={href} download>
        {body}
      </a>
    </Button>
  ) : (
    <Button
      variant="outline"
      className="w-full justify-between"
      onClick={onClick}
    >
      {body}
    </Button>
  );
}

function TrackLabel({
  icon: Icon,
  children,
}: {
  icon: typeof Film;
  children: React.ReactNode;
}) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{children}</span>
    </span>
  );
}

function PlannedTrack({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center rounded-md border border-dashed border-input px-3 text-xs text-faint">
      {children}
    </div>
  );
}
