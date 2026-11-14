import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Blend,
  Captions,
  Download,
  Eye,
  EyeOff,
  FileText,
  Film,
  ImageUp,
  Images,
  Layers,
  LoaderCircle,
  Music,
  Pencil,
  Redo2,
  Scissors,
  Sparkles,
  Terminal,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router";

import { Button } from "@/components/ui/button";
import { LibraryPickerDialog } from "@/features/library/components/library-picker-dialog";
import type { ProjectMedia } from "@/features/projects/api/media";
import { projectKeys } from "@/features/projects/api/query-keys";
import {
  clearCover,
  previewTimeline,
  setCover,
} from "@/features/projects/api/timeline";
import { LogoFields } from "@/features/projects/components/logo-fields";
import { MediaLibrary } from "@/features/projects/components/media-library";
import { MuseMusicDialog } from "@/features/projects/components/muse-music-dialog";
import { OutputSettingsFields } from "@/features/projects/components/output-settings-fields";
import {
  TimelineCutEditor,
  TimelineStrip,
} from "@/features/projects/components/studio-timeline";
import {
  AudioEditor,
  AudioLanes,
  CaptionEditor,
  CaptionLane,
  DuckField,
  SceneVolume,
} from "@/features/projects/components/timeline-lanes";
import { TitlesEditor } from "@/features/projects/components/titles-editor";
import { useProjectMedia } from "@/features/projects/hooks/use-project-media";
import { useProjectRender } from "@/features/projects/hooks/use-project-render";
import { useProjectTimeline } from "@/features/projects/hooks/use-project-timeline";
import { useTimelineDraft } from "@/features/projects/hooks/use-timeline-draft";
import { EFFECT_CSS } from "@/features/projects/lib/clip-effects";
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
  isRemovable,
  isTimelineValid,
  itemSeconds,
  MAX_AUDIO_TRACKS,
  MAX_TIMELINE_ITEMS,
  moveItem,
  snapPoints,
  SPEEDS,
  splitItem,
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
  "4:3": "mx-auto aspect-[4/3] max-h-[70svh]",
  "3:4": "mx-auto aspect-[3/4] max-h-[70svh]",
  "4:5": "mx-auto aspect-[4/5] max-h-[70svh]",
  "21:9": "aspect-[21/9] w-full",
} as const;
// How far the tracks can be stretched to work on a detail.
const ZOOMS = [1, 1.5, 2, 3, 4, 6, 8];
// The fade "fade between all clips" gives each clip, in seconds.
const FADE = 0.4;
const PANELS = ["media", "captions", "titles", "output"] as const;

// What is selected in the timeline: a piece of the picture, an audio piece,
// a caption or a title.
type Selection =
  | { kind: "clip"; key: string }
  | { kind: "audio"; key: string }
  | { kind: "caption"; index: number }
  | { kind: "title"; index: number }
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
  const client = useQueryClient();
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
  // The film's edit as it is being changed, with undo and a copy that
  // survives leaving the page; the saved one comes from the server.
  const editor = useTimelineDraft(project.id, timeline);
  const { draft, saved: savedDraft, dirty } = editor;
  const [selection, setSelection] = useState<Selection>(null);
  const [panel, setPanel] = useState<(typeof PANELS)[number]>("media");
  const [askingMusic, setAskingMusic] = useState(false);
  const [picking, setPicking] = useState(false);
  // An audio file from the media library is being dragged over its track.
  const [audioDrop, setAudioDrop] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [time, setTime] = useState(0);
  // A quick version of the draft to watch, and the draft it was made from.
  const [preview, setPreview] = useState<{ url: string; made: string } | null>(
    null,
  );
  const previewing = useMutation({ mutationFn: previewTimeline, retry: false });
  const cover = useMutation({
    mutationFn: (seconds: number | null) =>
      seconds === null
        ? clearCover(project.id)
        : setCover({ id: project.id, seconds }),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: projectKeys.detail(project.id),
      });
      void client.invalidateQueries({ queryKey: projectKeys.lists });
    },
  });
  const images = (useProjectMedia(project.id).query.data ?? []).filter(
    (media) => media.kind === "image",
  );

  const madeFrom = JSON.stringify(timelinePayload(draft));
  const previewStale = preview !== null && preview.made !== madeFrom;
  // What the film player shows: a fresh preview of the draft, or the film.
  const playing = preview && !previewStale ? draft.items : savedDraft.items;
  const segments = filmSegments(playing);
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
  const current = segments.length ? segmentAt(segments, time) : undefined;
  const videoUrl = render?.videoUrl ?? null;
  const finished = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(project.updatedAt));
  // One card per scene, however many pieces it was cut into.
  const scenes = savedDraft.items.filter(
    (item, index, items) =>
      item.kind === "scene" &&
      items.findIndex((other) => other.scene === item.scene) === index,
  );
  // The playhead is true to the tracks when they show what is playing.
  const inStep = preview ? !previewStale : !dirty && Boolean(videoUrl);

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

  function setItems(
    change: (items: TimelineItem[]) => TimelineItem[],
    label = "",
  ) {
    editor.change((edit) => ({ ...edit, items: change(edit.items) }), label);
  }

  function patchItem(key: string, patch: Partial<TimelineItem>) {
    setItems(
      (items) =>
        items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
      // Every tick of a drag or a slider is the same step.
      `clip:${key}:${Object.keys(patch).join()}`,
    );
  }

  function patchAudio(key: string, patch: Partial<TimelineAudio>) {
    editor.change(
      (edit) => ({
        ...edit,
        audio: edit.audio.map((item) =>
          item.key === key ? { ...item, ...patch } : item,
        ),
      }),
      `audio:${key}:${Object.keys(patch).join()}`,
    );
  }

  function patchTimed(
    list: "captions" | "titles",
    index: number,
    patch: { start?: number; end?: number },
  ) {
    editor.change(
      (edit) => ({
        ...edit,
        [list]: edit[list].map((entry, position) =>
          position === index ? { ...entry, ...patch } : entry,
        ),
      }),
      `${list}:${index}:${Object.keys(patch).join()}`,
    );
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
  // A clip cut in pieces has that room once: its other pieces take what they
  // keep.
  const sources = new Set<string>();
  const span = Math.max(
    kept.reduce((sum, item) => {
      const source = `${item.scene}:${item.mediaId}`;
      const first = !sources.has(source);
      sources.add(source);
      return sum + (first ? fullSeconds(item) : itemSeconds(item));
    }, 0),
    total,
    0.1,
  );
  // Where blocks on the lanes are drawn to: every cut, and the playhead.
  const snaps = [
    ...snapPoints(draft.items),
    ...(inStep ? [toTenth(time)] : []),
  ];

  // Takes the selected piece out of the film: an added clip, a part of a
  // scene that has another part, an audio piece, a caption or a title is
  // removed; the last piece of a scene is left out (its clip is kept).
  function removeSelected() {
    if (!selection) return;
    editor.change((edit) => {
      if (selection.kind === "audio")
        return {
          ...edit,
          audio: edit.audio.filter((item) => item.key !== selection.key),
        };
      if (selection.kind === "caption" || selection.kind === "title") {
        const list = selection.kind === "caption" ? "captions" : "titles";
        return {
          ...edit,
          [list]: edit[list].filter((_, index) => index !== selection.index),
        };
      }
      return {
        ...edit,
        items: edit.items.flatMap((item) =>
          item.key !== selection.key
            ? [item]
            : isRemovable(edit.items, item)
              ? []
              : [{ ...item, enabled: false }],
        ),
      };
    });
    setSelection(null);
  }

  // Cuts the selected clip in two where its preview is playing (or in the
  // middle when that is too close to an end).
  function splitSelected() {
    if (!cut || cut.kind === "image") return;
    const middle = (cut.start + cut.end) / 2;
    const cutAt = splitItem(
      draft.items,
      cut.key,
      clip.current?.currentTime ?? middle,
    );
    const halves = cutAt ?? splitItem(draft.items, cut.key, middle);
    if (!halves) return;
    setItems(() => halves.items);
    setSelection({ kind: "clip", key: halves.second });
  }

  // Moves the selected audio piece, caption or title along the film.
  function nudge(seconds: number) {
    if (selection?.kind === "audio" && track)
      patchAudio(track.key, {
        offset: Math.max(toTenth(track.offset + seconds), 0),
      });
    else if (selection?.kind === "caption" || selection?.kind === "title") {
      const list = selection.kind === "caption" ? "captions" : "titles";
      const entry = draft[list][selection.index];
      if (!entry) return;
      // Not past the longest film the server takes (one hour).
      const start = Math.min(
        Math.max(toTenth(entry.start + seconds), 0),
        Math.max(toTenth(3600 - (entry.end - entry.start)), 0),
      );
      patchTimed(list, selection.index, {
        start,
        end: toTenth(start + entry.end - entry.start),
      });
    }
  }

  // The keyboard works the editor unless something is being typed.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable=true]"))
        return;
      // A dialog is open over the editor: its keys are not the editor's.
      if (
        askingMusic ||
        picking ||
        target?.closest("[role=dialog], [role=alertdialog]")
      )
        return;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (!editable || (key !== "z" && key !== "y")) return;
        event.preventDefault();
        if (key === "y" || event.shiftKey) editor.redo();
        else editor.undo();
        return;
      }
      if (event.altKey) return;
      if (event.key === " ") {
        // Space on a focused control presses that control.
        if (target?.closest("button, a, summary, [role=radio], [role=tab]"))
          return;
        event.preventDefault();
        const player = clip.current ?? film.current;
        if (player?.paused) void player.play().catch(() => undefined);
        else player?.pause();
        return;
      }
      if (!editable) return;
      if (event.key === "Delete" || event.key === "Backspace") {
        if (!selection) return;
        event.preventDefault();
        removeSelected();
      } else if (key === "s") splitSelected();
      else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        if (!selection || selection.kind === "clip") return;
        event.preventDefault();
        nudge(
          (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 1 : 0.1),
        );
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // Subscribed afresh after every render, so the handlers above always
    // read the current draft and selection.
  });

  // One speed for every clip, or null when they differ.
  const clips = draft.items.filter((item) => item.kind !== "image");
  const filmSpeed = clips.every((item) => item.speed === clips[0]?.speed)
    ? (clips[0]?.speed ?? 1)
    : null;
  const faded = draft.items.some((item) => item.fadeIn > 0 || item.fadeOut > 0);

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
    editor.change((edit) => ({ ...edit, audio: [...edit.audio, item] }));
    setSelection({ kind: "audio", key: item.key });
  }

  function makePreview() {
    previewing.mutate(
      { id: project.id, ...timelinePayload(draft) },
      {
        onSuccess: (made) => {
          setPreview({ url: made.url, made: madeFrom });
          setSelection(null);
          setTime(0);
        },
      },
    );
  }

  // Files placed in the film, in this draft or in the saved edit: the
  // server refuses to delete the saved ones, and the draft's would be lost.
  const usedIds = new Set(
    [draft, savedDraft].flatMap((edit: TimelineDraft) => [
      ...[...edit.items, ...edit.audio].flatMap((item) =>
        item.mediaId ? [item.mediaId] : [],
      ),
      ...(edit.logo ? [edit.logo.mediaId] : []),
    ]),
  );
  const narrated =
    draft.captions.length === 0 &&
    captionsFromNarration(project, draft.items).length > 0;
  const shown = cut ?? current;
  const previewError = previewing.isError
    ? timelineErrorKey(previewing.error)
    : null;

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
                style={{
                  filter: EFFECT_CSS[cut.effect],
                  transform: cut.flip ? "scaleX(-1)" : undefined,
                }}
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
                // A stand-in for the look the film will have.
                style={{
                  filter: EFFECT_CSS[cut.effect],
                  transform: cut.flip ? "scaleX(-1)" : undefined,
                }}
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
            ) : (preview?.url ?? videoUrl) ? (
              <video
                ref={film}
                key={preview?.url ?? videoUrl}
                controls
                playsInline
                autoPlay={Boolean(preview)}
                preload="metadata"
                poster={preview ? undefined : (project.coverUrl ?? undefined)}
                src={preview?.url ?? videoUrl ?? undefined}
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
          {cut ? (
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
          ) : (
            preview && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary-line bg-primary-soft px-3 py-2">
                <Eye
                  className="size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <p className="min-w-0 flex-1 text-xs leading-5">
                  {t("projects.timeline.preview.note")}
                  {previewStale && ` ${t("projects.timeline.preview.stale")}`}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPreview(null)}
                >
                  <Film aria-hidden="true" />
                  {t("projects.timeline.preview.close")}
                </Button>
              </div>
            )
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
              const active = !cut && !preview && current?.scene === item.scene;
              return (
                <li key={item.key} className="min-w-0 space-y-1.5">
                  <button
                    type="button"
                    aria-label={t("projects.output.jumpTo", {
                      number: item.scene,
                    })}
                    aria-current={active ? "true" : undefined}
                    // A scene left out of the film has no place to jump to:
                    // open it for editing instead.
                    onClick={() => {
                      if (!segment)
                        return setSelection({ kind: "clip", key: item.key });
                      // Its place is in the film, not in a preview of a draft.
                      setPreview(null);
                      seek(segment.offset);
                    }}
                    className={cn(
                      "relative block aspect-video w-full overflow-hidden rounded-lg bg-background",
                      active && "ring-2 ring-primary",
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

        {/* Beside the player the column is as tall as the player's side and
            scrolls inside itself, so a long panel never pushes the timeline
            down the page. */}
        <aside className="relative min-w-0 border-t desktop:min-h-[32rem] desktop:border-t-0 desktop:border-l">
          <div className="scroll-subtle divide-y desktop:absolute desktop:inset-0 desktop:overflow-y-auto desktop:overscroll-contain">
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
                    Math.round(
                      timeline?.totalSeconds ?? project.durationSeconds,
                    ),
                  )}
                </dd>
                <dt className="text-muted-foreground">
                  {t("projects.details.ratio")}
                </dt>
                <dd>
                  {savedDraft.output.aspect === "source"
                    ? project.aspectRatio
                    : savedDraft.output.aspect}
                </dd>
                <dt className="text-muted-foreground">
                  {t("projects.details.scenes")}
                </dt>
                <dd>
                  {t("projects.output.scenesInFilm", {
                    kept: new Set(
                      saved.flatMap((segment) =>
                        segment.scene === null ? [] : [segment.scene],
                      ),
                    ).size,
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
                      scene: (number) =>
                        t("projects.details.scene", { number }),
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
              // What is selected in the timeline is edited here, beside the
              // player, so it is in view whichever track it is on.
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
                        isRemovable(draft.items, cut)
                          ? removeSelected
                          : undefined
                      }
                    />
                  ) : track ? (
                    <AudioEditor
                      track={track}
                      total={total}
                      editable={editable}
                      onChange={(patch) => patchAudio(track.key, patch)}
                      onRemove={removeSelected}
                    />
                  ) : (
                    <p className="text-[13px] leading-6 text-muted-foreground">
                      {t("projects.timeline.inspectorHint")}
                    </p>
                  )}
                  <div className="space-y-4 border-t pt-4">
                    <SceneVolume
                      volume={draft.volume}
                      muted={project.mute}
                      editable={editable}
                      onChange={(volume) =>
                        editor.change((edit) => ({ ...edit, volume }), "volume")
                      }
                    />
                    <DuckField
                      duck={draft.duck}
                      editable={editable}
                      onChange={(duck) =>
                        editor.change((edit) => ({ ...edit, duck }))
                      }
                    />
                  </div>
                </div>
              </section>
            )}
          </div>
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
            {dirty && (
              <span className="rounded-md bg-warning-soft px-2 py-0.5 text-xs text-warning">
                {t("projects.timeline.unsaved")}
              </span>
            )}
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
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                title={`${t("projects.timeline.undo")} (Ctrl+Z)`}
                aria-label={t("projects.timeline.undo")}
                disabled={!editable || !editor.canUndo}
                onClick={editor.undo}
              >
                <Undo2 aria-hidden="true" />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={`${t("projects.timeline.redo")} (Ctrl+Y)`}
                aria-label={t("projects.timeline.redo")}
                disabled={!editable || !editor.canRedo}
                onClick={editor.redo}
              >
                <Redo2 aria-hidden="true" />
              </Button>
              <Button
                variant="outline"
                disabled={!dirty || save.isPending}
                onClick={() => {
                  save.reset();
                  editor.reset();
                  setSelection(null);
                }}
              >
                {t("projects.timeline.reset")}
              </Button>
              <Button
                variant="outline"
                // Something new to look at: a changed draft, or no preview yet.
                disabled={
                  !isTimelineValid(draft) ||
                  previewing.isPending ||
                  (!dirty && !previewStale) ||
                  (preview !== null && !previewStale)
                }
                onClick={makePreview}
              >
                {previewing.isPending ? (
                  <LoaderCircle
                    className="motion-safe:animate-spin motion-reduce:animate-pulse"
                    aria-hidden="true"
                  />
                ) : (
                  <Eye aria-hidden="true" />
                )}
                {t(
                  previewing.isPending
                    ? "projects.timeline.preview.building"
                    : "projects.timeline.preview.action",
                )}
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
          {editor.restored && (
            <p role="status" className="text-xs text-warning">
              {t("projects.timeline.restored")}
            </p>
          )}
          {previewError && (
            <p role="alert" className="text-xs text-destructive">
              {t(
                previewError === "projects.timeline.errors.unknown"
                  ? "projects.timeline.preview.error"
                  : previewError,
              )}
            </p>
          )}
          {save.isError && (
            <p role="alert" className="text-xs text-destructive">
              {t(timelineErrorKey(save.error))}
            </p>
          )}

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
                {SPEEDS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={filmSpeed === value}
                    disabled={!editable}
                    onClick={() =>
                      setItems((items) =>
                        items.map((item) =>
                          item.kind === "image"
                            ? item
                            : { ...item, speed: value },
                        ),
                      )
                    }
                    className={cn(
                      "h-7 rounded-md border px-2 font-mono text-xs disabled:opacity-50",
                      filmSpeed === value
                        ? "border-primary bg-primary-soft text-primary"
                        : "border-input text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {value}×
                  </button>
                ))}
              </div>
              {filmSpeed === null && (
                <span className="text-xs text-faint">
                  {t("projects.timeline.filmSpeedMixed")}
                </span>
              )}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!editable}
                onClick={() =>
                  setItems((items) =>
                    items.map((item) => ({
                      ...item,
                      fadeIn: faded ? 0 : FADE,
                      fadeOut: faded ? 0 : FADE,
                    })),
                  )
                }
              >
                <Blend aria-hidden="true" />
                {t(
                  faded
                    ? "projects.timeline.effects.fadeNone"
                    : "projects.timeline.effects.fadeAll",
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                title={t("projects.timeline.splitHint")}
                disabled={!editable || !cut || cut.kind === "image"}
                onClick={splitSelected}
              >
                <Scissors aria-hidden="true" />
                {t("projects.timeline.split")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!editable || !selection}
                onClick={removeSelected}
              >
                <Trash2 aria-hidden="true" />
                {t("projects.timeline.removeSelected")}
              </Button>
              {/* Stretches the tracks to work on a detail. */}
              <div
                role="group"
                aria-label={t("projects.timeline.zoom.label")}
                className="flex items-center gap-1"
              >
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("projects.timeline.zoom.out")}
                  disabled={zoom === ZOOMS[0]}
                  onClick={() =>
                    setZoom(ZOOMS[Math.max(ZOOMS.indexOf(zoom) - 1, 0)])
                  }
                >
                  <ZoomOut aria-hidden="true" />
                </Button>
                <button
                  type="button"
                  title={t("projects.timeline.zoom.fit")}
                  onClick={() => setZoom(1)}
                  className="w-9 rounded text-center font-mono text-xs text-muted-foreground hover:text-foreground"
                >
                  {zoom}×
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t("projects.timeline.zoom.in")}
                  disabled={zoom === ZOOMS.at(-1)}
                  onClick={() =>
                    setZoom(
                      ZOOMS[
                        Math.min(ZOOMS.indexOf(zoom) + 1, ZOOMS.length - 1)
                      ],
                    )
                  }
                >
                  <ZoomIn aria-hidden="true" />
                </Button>
              </div>
            </div>
          </div>

          {/* Scrolls sideways when zoomed in; the labels stay in view. */}
          <div className="scroll-subtle overflow-x-auto pb-1.5">
            <div
              style={{
                width:
                  zoom === 1
                    ? undefined
                    : `calc(5.5rem + (100% - 5.5rem) * ${zoom})`,
              }}
              className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5"
            >
              <span className="sticky left-0 z-30 h-5 bg-card" />
              {/* Seconds along the film; click to jump there. */}
              <div
                className={cn(
                  "relative h-5 border-b border-input font-mono text-[10px] text-faint",
                  inStep && "cursor-pointer",
                )}
                onClick={(event) => {
                  if (!inStep || total <= 0) return;
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
                  canRemove={(item) => isRemovable(draft.items, item)}
                  onRemove={(key) => {
                    setItems((items) =>
                      items.filter((item) => item.key !== key),
                    );
                    setSelection(null);
                  }}
                />
                {/* Where the film is playing, while the tracks show it. */}
                {!cut && inStep && total > 0 && (
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
                        selection?.kind === "clip" &&
                        selection.key === item.key;
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
                  audioDrop &&
                    "ring-2 ring-primary ring-offset-2 ring-offset-card",
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
                    snaps={snaps}
                    selected={
                      selection?.kind === "audio" ? selection.key : null
                    }
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
                  snaps={snaps}
                  selected={
                    selection?.kind === "caption" ? selection.index : null
                  }
                  editable={editable}
                  onSelect={(index) => {
                    setSelection({ kind: "caption", index });
                    setPanel("captions");
                  }}
                  onChange={(index, patch) =>
                    patchTimed("captions", index, patch)
                  }
                />
              ) : (
                <EmptyLane>
                  {t("projects.timeline.captions.emptyLane")}
                </EmptyLane>
              )}

              <TrackLabel icon={Type}>
                {t("projects.timeline.titles.title")}
              </TrackLabel>
              {draft.titles.length > 0 ? (
                <CaptionLane
                  captions={draft.titles}
                  span={span}
                  snaps={snaps}
                  tone="bg-success-soft text-success"
                  selected={
                    selection?.kind === "title" ? selection.index : null
                  }
                  editable={editable}
                  onSelect={(index) => {
                    setSelection({ kind: "title", index });
                    setPanel("titles");
                  }}
                  onChange={(index, patch) =>
                    patchTimed("titles", index, patch)
                  }
                />
              ) : (
                <EmptyLane>{t("projects.timeline.titles.emptyLane")}</EmptyLane>
              )}
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={editor.follow}
              onChange={(event) => editor.setFollow(event.target.checked)}
              className="size-3.5 accent-primary"
            />
            {t("projects.timeline.followClips")}
          </label>

          <div className="min-w-0 space-y-4 rounded-xl border p-4 tablet:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <div role="tablist" className="flex flex-wrap gap-1">
                {PANELS.map((name) => (
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
                    {t(`projects.timeline.panels.${name}`)}
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
            {panel === "media" && (
              <MediaLibrary
                projectId={project.id}
                // The server refuses changes while the film is merged.
                disabled={merging}
                usedIds={usedIds}
                onAddClip={editable ? (media) => addClip(media) : undefined}
                onAddAudio={editable ? (media) => addAudio(media) : undefined}
              />
            )}
            {panel === "captions" && (
              <CaptionEditor
                captions={draft.captions}
                burn={draft.burnCaptions}
                style={draft.captionStyle}
                onStyle={(patch) =>
                  editor.change(
                    (edit) => ({
                      ...edit,
                      captionStyle: { ...edit.captionStyle, ...patch },
                    }),
                    `caption-style:${Object.keys(patch).join()}`,
                  )
                }
                canBurn={timeline?.canBurnCaptions ?? false}
                selected={
                  selection?.kind === "caption" ? selection.index : null
                }
                editable={editable}
                at={cut ? 0 : Math.min(time, Math.max(total - 2, 0))}
                onChange={(captions) =>
                  editor.change(
                    (edit) => ({ ...edit, captions }),
                    // Typing in one caption is one step.
                    captions.length === draft.captions.length
                      ? "captions:text"
                      : "",
                  )
                }
                onBurn={(burnCaptions) =>
                  editor.change((edit) => ({ ...edit, burnCaptions }))
                }
                onSelect={(index) =>
                  setSelection(
                    index === null ? null : { kind: "caption", index },
                  )
                }
                onFromNarration={
                  narrated
                    ? () =>
                        editor.change((edit) => ({
                          ...edit,
                          captions: captionsFromNarration(project, edit.items),
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
            {panel === "titles" && (
              <fieldset disabled={!editable} className="min-w-0 space-y-5">
                <legend className="sr-only">
                  {t("projects.timeline.panels.titles")}
                </legend>
                <TitlesEditor
                  titles={draft.titles}
                  at={cut ? 0 : Math.min(time, Math.max(total - 3, 0))}
                  selected={
                    selection?.kind === "title" ? selection.index : null
                  }
                  onChange={(titles) =>
                    editor.change(
                      (edit) => ({ ...edit, titles }),
                      titles.length === draft.titles.length
                        ? "titles:edit"
                        : "",
                    )
                  }
                  onSelect={(index) =>
                    setSelection(
                      index === null ? null : { kind: "title", index },
                    )
                  }
                />
                <div className="border-t pt-4">
                  <LogoFields
                    logo={draft.logo}
                    images={images}
                    onChange={(logo) =>
                      editor.change((edit) => ({ ...edit, logo }), "logo")
                    }
                  />
                </div>
              </fieldset>
            )}
            {panel === "output" && (
              <div className="space-y-5">
                <fieldset disabled={!editable} className="min-w-0">
                  <legend className="sr-only">
                    {t("projects.timeline.panels.output")}
                  </legend>
                  <OutputSettingsFields
                    value={draft.output}
                    sourceAspect={project.aspectRatio}
                    onChange={(patch) =>
                      editor.change((edit) => ({
                        ...edit,
                        output: { ...edit.output, ...patch },
                      }))
                    }
                  />
                </fieldset>
                {/* The cover is taken from the finished film, not the draft. */}
                <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!videoUrl || Boolean(preview) || cover.isPending}
                    onClick={() => cover.mutate(time)}
                  >
                    <ImageUp aria-hidden="true" />
                    {t("projects.timeline.cover.set")}
                    <span className="font-mono text-xs text-faint">
                      {formatDuration(Math.floor(time))}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!videoUrl || cover.isPending}
                    onClick={() => cover.mutate(null)}
                  >
                    {t("projects.timeline.cover.reset")}
                  </Button>
                  {cover.isSuccess && (
                    <p role="status" className="text-xs text-success">
                      {t("projects.timeline.cover.done")}
                    </p>
                  )}
                  {cover.isError && (
                    <p role="alert" className="text-xs text-destructive">
                      {t("projects.timeline.cover.error")}
                    </p>
                  )}
                </div>
              </div>
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
    // Stays in view when the tracks are scrolled sideways.
    <span className="sticky left-0 z-30 flex h-full items-center gap-1.5 bg-card text-xs text-muted-foreground">
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
