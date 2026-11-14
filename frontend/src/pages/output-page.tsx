import {
  Captions,
  Download,
  EyeOff,
  FileText,
    Film,
  Images,
  Layers,
  LoaderCircle,
  Music,
  Pencil,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router";

import { Button } from "@/components/ui/button";
import { LibraryPickerDialog } from "@/features/library/components/library-picker-dialog";
import type { ProjectMedia } from "@/features/projects/api/media";
import { MediaLibrary } from "@/features/projects/components/media-library";
import { MuseMusicDialog } from "@/features/projects/components/muse-music-dialog";
import {
  TimelineCutEditor,
  TimelineStrip,
} from "@/features/projects/components/studio-timeline";
import {
  AudioEditor,
  AudioLanes,
  CaptionEditor,
  CaptionLane,
  SceneVolume,
} from "@/features/projects/components/timeline-lanes";
import { useProjectRender } from "@/features/projects/hooks/use-project-render";
import { useProjectTimeline } from "@/features/projects/hooks/use-project-timeline";
import {
  carriesMedia,
  DRAG_AUDIO,
  droppedMedia,
} from "@/features/projects/lib/media-drag";
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
  audioFromMedia,
  captionsFromNarration,
  captionsSrt,
  clipFromMedia,
  draftOf,
  fullSeconds,
  isTimelineValid,
  itemSeconds,
  MAX_AUDIO_TRACKS,
  MAX_TIMELINE_ITEMS,
  moveItem,
  SPEEDS,
  type TimelineDraft,
  timelineErrorKey,
  timelinePayload,
  timelineSeconds,
  toTenth,
} from "@/features/projects/lib/project-timeline";
import type {
  Project,
  ProjectRender,
  ProjectTimeline,
  TimelineAudio,
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

// What is selected in the timeline: a piece of the picture, an audio piece,
// or a caption.
type Selection =
  | { kind: "clip"; key: string }
  | { kind: "audio"; key: string }
  | { kind: "caption"; index: number }
  | null;

// Step 4 of a project, "Thành phẩm" (design board 14): the finished film,
// its scenes, downloads and exports, and the timeline that decides how the
// film is put together.
export function OutputPage() {
  const project = useOutletContext<Project>();
  const render = useProjectRender(project.id);
  const timeline = useProjectTimeline(project.id);

  return (
    <Output
      // The draft starts over from whatever the server now holds.
      key={JSON.stringify(
        timeline.query.data ? draftOf(timeline.query.data) : null,
      )}
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
  // The film's edit as it is being changed; the saved one comes from the server.
  const [draft, setDraft] = useState<TimelineDraft>(() => draftOf(timeline));
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<"media" | "captions">("media");
  const [askingMusic, setAskingMusic] = useState(false);
  const [picking, setPicking] = useState(false);
  // An audio file from the media library is being dragged over its track.
  const [audioDrop, setAudioDrop] = useState(false);
  const [time, setTime] = useState(0);

  const savedDraft = draftOf(timeline);
  const saved = filmSegments(savedDraft.items);
  const total = timelineSeconds(draft.items);
  // The piece being trimmed is previewed on its own; null shows the film.
  const cutIndex =
    selection?.kind === "clip"
      ? draft.items.findIndex((item) => item.key === selection.key)
      : -1;
  const cut = cutIndex >= 0 ? draft.items[cutIndex] : undefined;
  const track =
    selection?.kind === "audio"
      ? draft.audio.find((item) => item.key === selection.key)
      : undefined;
  const merging = timeline ? isRenderActive(timeline.status) : false;
  const editable = Boolean(timeline?.editable) && !save.isPending;
  const dirty =
    timeline !== undefined &&
    JSON.stringify(timelinePayload(draft)) !==
      JSON.stringify(timelinePayload(savedDraft));
  const current = saved.length ? segmentAt(saved, time) : undefined;
  const videoUrl = render?.videoUrl ?? null;
  const finished = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(project.updatedAt));
  const scenes = savedDraft.items.filter((item) => item.kind === "scene");

  // A preview plays at the speed the piece will have in the film.
  const speed = cut?.speed ?? 1;
  useEffect(() => {
    if (clip.current) clip.current.playbackRate = speed;
  }, [speed, cut?.key]);

  function seek(seconds: number) {
    setSelection(null);
    setTime(seconds);
    // The film player mounts after the selection clears; seek once it is there.
    requestAnimationFrame(() => {
      if (!film.current) return;
      film.current.currentTime = seconds;
      void film.current.play().catch(() => undefined);
    });
  }

  function setItems(change: (items: TimelineItem[]) => TimelineItem[]) {
    setDraft((edit) => ({ ...edit, items: change(edit.items) }));
  }

  function patchItem(key: string, patch: Partial<TimelineItem>) {
    setItems((items) =>
      items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }

  function patchAudio(key: string, patch: Partial<TimelineAudio>) {
    setDraft((edit) => ({
      ...edit,
      audio: edit.audio.map((item) =>
        item.key === key ? { ...item, ...patch } : item,
      ),
    }));
  }

  function move(from: number, to: number) {
    setItems((items) => moveItem(items, from, to));
  }

  // The picture track holds the pieces that are in the film, so it lines up
  // with the ruler; pieces left out wait in their own row.
  const kept = draft.items.filter((item) => item.enabled);
  const leftOut = draft.items.filter((item) => !item.enabled);
  const indexOf = (item: TimelineItem) => draft.items.indexOf(item);
  // Seconds the full track width stands for: the kept pieces untrimmed, so
  // the scale holds still while a clip is trimmed.
  const span = Math.max(
    kept.reduce((sum, item) => sum + fullSeconds(item), 0),
    0.1,
  );

  // Takes the selected piece out of the film: an added clip, an audio
  // piece or a caption is removed; a scene is left out (its clip is kept).
  function removeSelected() {
    if (!selection) return;
    setDraft((edit) => {
      if (selection.kind === "audio")
        return {
          ...edit,
          audio: edit.audio.filter((item) => item.key !== selection.key),
        };
      if (selection.kind === "caption")
        return {
          ...edit,
          captions: edit.captions.filter(
            (_, index) => index !== selection.index,
          ),
        };
      return {
        ...edit,
        items: edit.items.flatMap((item) =>
          item.key !== selection.key
            ? [item]
            : item.mediaId === null
              ? [{ ...item, enabled: false }]
              : [],
        ),
      };
    });
    setSelection(null);
  }

  // Delete or Backspace removes what is selected, unless something is typed.
  useEffect(() => {
    if (!editable || !selection) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]"))
        return;
      event.preventDefault();
      removeSelected();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // removeSelected reads only the selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, selection]);

  // One speed for every clip, or null when they differ.
  const clips = draft.items.filter((item) => item.kind !== "image");
  const filmSpeed = clips.every((item) => item.speed === clips[0]?.speed)
    ? (clips[0]?.speed ?? 1)
    : null;

  function trimClip(key: string, edge: "start" | "end", seconds: number) {
    patchItem(key, { [edge]: seconds });
    // Show the frame the cut now lands on, as an editor does while trimming.
    if (clip.current) {
      clip.current.pause();
      clip.current.currentTime =
        edge === "end" ? Math.max(seconds - 0.05, 0) : seconds;
    }
  }

  // `before` is the position among the kept pieces to put it at (dropped
  // on the track); without it the piece goes to the end of the film.
  function addClip(media: ProjectMedia, before?: number) {
    if (draft.items.length >= MAX_TIMELINE_ITEMS) return;
    const item = clipFromMedia(media);
    setItems((items) => {
      const next = items.filter((entry) => entry.enabled)[before ?? -1];
      const at = next ? items.indexOf(next) : items.length;
      return [...items.slice(0, at), item, ...items.slice(at)];
    });
    setSelection({ kind: "clip", key: item.key });
  }

  // `offset` is where in the film it starts (dropped on the track).
  function addAudio(media: ProjectMedia, offset = 0) {
    if (draft.audio.length >= MAX_AUDIO_TRACKS) return;
    const item = { ...audioFromMedia(media), offset };
    setDraft((edit) => ({ ...edit, audio: [...edit.audio, item] }));
    setSelection({ kind: "audio", key: item.key });
  }

  // Files placed in the film, in this draft or in the saved edit: the
  // server refuses to delete the saved ones, and the draft's would be lost.
  const usedIds = new Set(
    [draft, savedDraft]
      .flatMap((edit) => [...edit.items, ...edit.audio])
      .flatMap((item) => (item.mediaId ? [item.mediaId] : [])),
  );
  const narrated =
    draft.captions.length === 0 &&
    captionsFromNarration(project, draft.items).length > 0;
  const shown = cut ?? current;

  return (
    <>
      <div className="grid desktop:grid-cols-[minmax(0,1fr)_23.75rem]">
        <section className="min-w-0 space-y-5 p-4 tablet:p-6">
          <div className="relative overflow-hidden rounded-lg bg-black">
            {cut && !cut.videoUrl ? (
              // A picture: shown as it will be, for as long as its entry says.
              <img
                src={cut.thumbnailUrl ?? undefined}
                alt={cut.title}
                className={cn(
                  "object-contain",
                  VIDEO_FRAMES[project.aspectRatio],
                )}
              />
            ) : cut?.videoUrl ? (
              <video
                ref={clip}
                key={cut.key}
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
                  event.currentTarget.playbackRate = cut.speed;
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
            {shown && (
              <span className="pointer-events-none absolute top-3 left-3 max-w-[80%] truncate rounded-md bg-black/70 px-2 py-1 text-xs text-white">
                {shown.scene !== null &&
                  `${t("projects.details.scene", { number: shown.scene })} · `}
                {shown.title}
              </span>
            )}
          </div>
          {cut && (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-xs text-muted-foreground">
                {cut.scene === null
                  ? t("projects.output.previewingClip")
                  : t("projects.output.previewing", { number: cut.scene })}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelection(null)}
              >
                <Film aria-hidden="true" />
                {t("projects.output.watchFilm")}
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {t("projects.sceneCount", { count: scenes.length })}
            </h2>
            <p className="text-xs text-faint">
              {t("projects.output.sceneHint")}
            </p>
          </div>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3">
            {scenes.map((item) => {
              const segment = saved.find((entry) => entry.key === item.key);
              const playing = !cut && current?.key === item.key;
              return (
                <li key={item.key} className="min-w-0 space-y-1.5">
                  <button
                    type="button"
                    aria-label={t("projects.output.jumpTo", {
                      number: item.scene,
                    })}
                    aria-current={playing ? "true" : undefined}
                    // A scene left out of the film has no place to jump to:
                    // open it for editing instead.
                    onClick={() =>
                      segment
                        ? seek(segment.offset)
                        : setSelection({ kind: "clip", key: item.key })
                    }
                    className={cn(
                      "relative block aspect-video w-full overflow-hidden rounded-lg bg-background",
                      playing && "ring-2 ring-primary",
                      !item.enabled && "opacity-45",
                    )}
                  >
                    {item.thumbnailUrl && (
                      <img
                        src={item.thumbnailUrl}
                        alt=""
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    )}
                    <span className="absolute top-1.5 left-1.5 rounded bg-black/70 px-1.5 font-mono text-[10px] leading-4 text-white">
                      {String(item.scene).padStart(2, "0")}
                    </span>
                    <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 font-mono text-[10px] leading-4 text-white">
                      {item.enabled
                        ? `${itemSeconds(item).toFixed(1)}s`
                        : t("projects.timeline.excluded")}
                    </span>
                  </button>
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-[13px]">
                      {item.title}
                    </span>
                    {item.videoUrl && (
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
                    )}
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
                  kept: saved.filter((segment) => segment.scene !== null)
                    .length,
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
            {scenes.length > 0 && (
              <FileButton
                icon={Layers}
                label={t("projects.output.allScenes")}
                detail={t("projects.output.files", { count: scenes.length })}
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
          {draft.items.length > 0 && (
            <section className="space-y-5 bg-background/40 p-4 tablet:p-5">
              <div className="min-w-0 space-y-5 rounded-xl border bg-card p-4 shadow-sm">
                {cut ? (
                  <TimelineCutEditor
                    item={cut}
                    index={cutIndex}
                    count={draft.items.length}
                    editable={editable}
                    onChange={(patch) => patchItem(cut.key, patch)}
                    onMove={move}
                    onRemove={
                      cut.mediaId === null
                        ? undefined
                        : () => {
                            setItems((items) =>
                              items.filter((item) => item.key !== cut.key),
                            );
                            setSelection(null);
                          }
                    }
                  />
                ) : track ? (
                  <AudioEditor
                    track={track}
                    total={total}
                    editable={editable}
                    onChange={(patch) => patchAudio(track.key, patch)}
                    onRemove={() => {
                      setDraft((edit) => ({
                        ...edit,
                        audio: edit.audio.filter(
                          (item) => item.key !== track.key,
                        ),
                      }));
                      setSelection(null);
                    }}
                  />
                ) : (
                  <p className="text-[13px] leading-6 text-muted-foreground">
                    {t("projects.timeline.inspectorHint")}
                  </p>
                )}
                <div className="border-t pt-4">
                  <SceneVolume
                    volume={draft.volume}
                    muted={project.mute}
                    editable={editable}
                    onChange={(volume) =>
                      setDraft((edit) => ({ ...edit, volume }))
                    }
                  />
                </div>
              </div>
            </section>
          )}
        </aside>
      </div>

      {draft.items.length > 0 && (
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
                  setDraft(savedDraft);
                  setSelection(null);
                }}
              >
                {t("projects.timeline.reset")}
              </Button>
              <Button
                disabled={!editable || !dirty || !isTimelineValid(draft)}
                onClick={() =>
                  save.mutate({ id: project.id, ...timelinePayload(draft) })
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

          {/* Tools for the film as a whole and for what is selected. */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-background px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <span id="film-speed" className="text-xs font-medium">
                {t("projects.timeline.filmSpeed")}
              </span>
              <div
                role="radiogroup"
                aria-labelledby="film-speed"
                className="flex flex-wrap gap-1"
              >
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    role="radio"
                    aria-checked={filmSpeed === speed}
                    disabled={!editable}
                    onClick={() =>
                      setItems((items) =>
                        items.map((item) =>
                          item.kind === "image" ? item : { ...item, speed },
                        ),
                      )
                    }
                    className={cn(
                      "h-7 rounded-md border px-2 font-mono text-xs disabled:opacity-50",
                      filmSpeed === speed
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-input text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {speed}×
                  </button>
                ))}
              </div>
              {filmSpeed === null && (
                <span className="text-xs text-faint">
                  {t("projects.timeline.filmSpeedMixed")}
                </span>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              className="ml-auto"
              disabled={!editable || !selection}
              onClick={removeSelected}
            >
              <Trash2 aria-hidden="true" />
              {t("projects.timeline.removeSelected")}
            </Button>
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
                selected={selection?.kind === "clip" ? selection.key : null}
                editable={editable}
                onSelect={(key) => setSelection({ kind: "clip", key })}
                span={span}
                onMove={(from, to) =>
                  move(indexOf(kept[from]), indexOf(kept[to]))
                }
                onTrim={trimClip}
                onDropMedia={addClip}
                onRemove={(key) => {
                  setItems((items) => items.filter((item) => item.key !== key));
                  setSelection(null);
                }}
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
                  {leftOut.map((item) => {
                    const chosen =
                      selection?.kind === "clip" && selection.key === item.key;
                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          aria-pressed={chosen}
                          onClick={() =>
                            setSelection({ kind: "clip", key: item.key })
                          }
                          className={cn(
                            "flex h-8 items-center gap-2 rounded-md border px-2 text-xs text-muted-foreground hover:text-foreground",
                            chosen ? "border-primary" : "border-input",
                          )}
                        >
                          {item.scene !== null && (
                            <span className="font-mono text-[10px]">
                              {item.scene}
                            </span>
                          )}
                          <span className="max-w-40 truncate">
                            {item.title}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <TrackLabel icon={Music}>
              {t("projects.output.tracks.music")}
            </TrackLabel>
            {/* An audio file dragged from the media library starts where
                it is dropped. */}
            <div
              className={cn(
                "rounded-md",
                audioDrop && "ring-2 ring-primary ring-offset-2 ring-offset-card",
              )}
              onDragOver={(event) => {
                if (!editable || !carriesMedia(event, DRAG_AUDIO)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setAudioDrop(true);
              }}
              onDragLeave={(event) => {
                if (
                  !event.currentTarget.contains(
                    event.relatedTarget as Node | null,
                  )
                )
                  setAudioDrop(false);
              }}
              onDrop={(event) => {
                setAudioDrop(false);
                const media = editable && droppedMedia(event, DRAG_AUDIO);
                if (!media) return;
                event.preventDefault();
                const box = event.currentTarget.getBoundingClientRect();
                const at = ((event.clientX - box.left) / box.width) * span;
                addAudio(
                  media,
                  Math.min(
                    Math.max(toTenth(at), 0),
                    Math.max(toTenth(total - 0.5), 0),
                  ),
                );
              }}
            >
              {draft.audio.length > 0 ? (
                <AudioLanes
                  tracks={draft.audio}
                  total={total}
                  span={span}
                  selected={selection?.kind === "audio" ? selection.key : null}
                  editable={editable}
                  onSelect={(key) => setSelection({ kind: "audio", key })}
                  onChange={patchAudio}
                />
              ) : (
                <EmptyLane>{t("projects.timeline.audio.empty")}</EmptyLane>
              )}
            </div>

            <TrackLabel icon={Captions}>
              {t("projects.output.tracks.subtitles")}
            </TrackLabel>
            {draft.captions.length > 0 ? (
              <CaptionLane
                captions={draft.captions}
                span={span}
                selected={
                  selection?.kind === "caption" ? selection.index : null
                }
                editable={editable}
                onSelect={(index) => {
                  setSelection({ kind: "caption", index });
                  setPanel("captions");
                }}
                onChange={(index, patch) =>
                  setDraft((edit) => ({
                    ...edit,
                    captions: edit.captions.map((caption, position) =>
                      position === index ? { ...caption, ...patch } : caption,
                    ),
                  }))
                }
              />
            ) : (
              <EmptyLane>{t("projects.timeline.captions.emptyLane")}</EmptyLane>
            )}
          </div>

          {save.isError && (
            <p role="alert" className="text-xs text-destructive">
              {t(timelineErrorKey(save.error))}
            </p>
          )}

          <div className="min-w-0 space-y-4 rounded-xl border p-4 tablet:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" className="flex gap-1">
                {(["media", "captions"] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={panel === name}
                    onClick={() => setPanel(name)}
                    className={cn(
                      "h-8 rounded-md px-3 text-[13px] font-medium",
                      panel === name
                        ? "bg-secondary text-foreground"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t(
                      name === "media"
                        ? "projects.media.title"
                        : "projects.timeline.captions.title",
                    )}
                  </button>
                ))}
              </div>
              {panel === "media" && (
                  <div className="ml-auto flex flex-wrap gap-2">
                    {/* Files kept in the media library, copied into the project. */}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={merging}
                      onClick={() => setPicking(true)}
                    >
                      <Images aria-hidden="true" />
                      {t("library.picker.open")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setAskingMusic(true)}
                    >
                      <Sparkles aria-hidden="true" />
                      {t("projects.music.open")}
                    </Button>
                  </div>
                )}
            </div>
            {panel === "media" ? (
              <MediaLibrary
                projectId={project.id}
                // The server refuses changes while the film is merged.
                disabled={merging}
                usedIds={usedIds}
                onAddClip={editable ? (media) => addClip(media) : undefined}
                onAddAudio={
                  editable ? (media) => addAudio(media) : undefined
                }
              />
            ) : (
              <CaptionEditor
                captions={draft.captions}
                burn={draft.burnCaptions}
                style={draft.captionStyle}
                onStyle={(patch) =>
                  setDraft((edit) => ({
                    ...edit,
                    captionStyle: { ...edit.captionStyle, ...patch },
                  }))
                }
                canBurn={timeline?.canBurnCaptions ?? false}
                selected={
                  selection?.kind === "caption" ? selection.index : null
                }
                editable={editable}
                at={cut ? 0 : Math.min(time, Math.max(total - 2, 0))}
                onChange={(captions) =>
                  setDraft((edit) => ({ ...edit, captions }))
                }
                onBurn={(burnCaptions) =>
                  setDraft((edit) => ({ ...edit, burnCaptions }))
                }
                onSelect={(index) =>
                  setSelection(
                    index === null ? null : { kind: "caption", index },
                  )
                }
                onFromNarration={
                  narrated
                    ? () =>
                        setDraft((edit) => ({
                          ...edit,
                          captions: captionsFromNarration(
                            project,
                            edit.items,
                          ),
                        }))
                    : undefined
                }
                onDownload={() =>
                  downloadText(
                    project,
                    "srt",
                    captionsSrt(draft.captions),
                    "application/x-subrip",
                  )
                }
              />
            )}
          </div>

          <p className="text-xs leading-5 text-faint">
            {t(
              timeline?.editable || merging
                ? "projects.timeline.hint"
                : "projects.timeline.locked",
            )}
          </p>
        </section>
      )}
      {askingMusic && (
        <MuseMusicDialog
          project={project}
          onClose={() => setAskingMusic(false)}
        />
      )}
      {picking && (
        <LibraryPickerDialog
          projectId={project.id}
          onClose={() => setPicking(false)}
        />
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

function EmptyLane({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-8 items-center rounded-md border border-dashed border-input px-3 text-xs text-faint">
      {children}
    </div>
  );
}
