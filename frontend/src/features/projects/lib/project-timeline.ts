import { ApiError } from "@/lib/http";
import type { ProjectMedia } from "../api/media";
import type { TimelinePayload } from "../api/timeline";
import { TIMELINE_ERROR_CODES } from "../constants";
import type {
  Project,
  ProjectTimeline,
  TimelineAudio,
  TimelineCaption,
  TimelineItem,
} from "../types";

// The shortest piece of a clip that may be kept (mirrors the server).
export const MIN_CUT_SECONDS = 0.5;
// Speeds offered for a clip; the server takes anything from 0.25 to 4.
export const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;
// How long a picture is shown when it is first placed.
export const STILL_SECONDS = 3;
export const MAX_TIMELINE_ITEMS = 60;
export const MAX_AUDIO_TRACKS = 8;
export const MAX_CAPTIONS = 300;
export const CAPTION_LENGTH = 300;

/** The part of the timeline the editor changes. */
export type TimelineDraft = Pick<
  ProjectTimeline,
  "items" | "audio" | "volume" | "captions" | "burnCaptions" | "captionStyle"
>;

export const EMPTY_DRAFT: TimelineDraft = {
  items: [],
  audio: [],
  volume: 1,
  captions: [],
  burnCaptions: true,
  captionStyle: {
    size: "medium",
    color: "#FFFFFF",
    outline: "#000000",
    position: "bottom",
    bold: false,
    box: false,
  },
};

export function draftOf(timeline: ProjectTimeline | undefined): TimelineDraft {
  if (!timeline) return EMPTY_DRAFT;
  const { items, audio, volume, captions, burnCaptions, captionStyle } =
    timeline;
  return { items, audio, volume, captions, burnCaptions, captionStyle };
}

/** What the server stores: the edit without what it derives itself. */
export function timelinePayload(draft: TimelineDraft): TimelinePayload {
  return {
    items: draft.items.map((item) => {
      const cut = {
        start: item.start,
        end: item.end,
        enabled: item.enabled,
        speed: item.speed,
      };
      return item.mediaId === null
        ? { scene: item.scene ?? 0, ...cut }
        : { mediaId: item.mediaId, key: item.key, ...cut };
    }),
    audio: draft.audio.map(
      ({ mediaId, key, offset, start, end, volume, loop }) => ({
        mediaId,
        key,
        offset,
        start,
        end,
        volume,
        loop,
      }),
    ),
    volume: draft.volume,
    captions: draft.captions
      .filter((caption) => caption.text.trim())
      .map(({ start, end, text }) => ({ start, end, text })),
    burnCaptions: draft.burnCaptions,
    captionStyle: draft.captionStyle,
  };
}

/** How long a kept piece plays for in the film. */
export function itemSeconds(item: TimelineItem) {
  return (item.end - item.start) / item.speed;
}

/** How long the whole clip would play for: the room it has on the track. */
export function fullSeconds(item: TimelineItem) {
  // A picture has no length of its own.
  return item.kind === "image" ? item.end : item.clipSeconds / item.speed;
}

export function timelineSeconds(items: TimelineItem[]) {
  return items.reduce(
    (total, item) => total + (item.enabled ? itemSeconds(item) : 0),
    0,
  );
}

/** How long an audio piece plays for in a film of this length. */
export function audioSeconds(track: TimelineAudio, total: number) {
  const room = Math.max(total - track.offset, 0);
  return track.loop ? room : Math.min(track.end - track.start, room);
}

export function isTimelineValid(draft: TimelineDraft) {
  const long = (piece: { start: number; end: number }) =>
    piece.end - piece.start >= MIN_CUT_SECONDS - 1e-6;
  return (
    draft.items.some((item) => item.enabled) &&
    draft.items.every(long) &&
    draft.audio.every(long) &&
    draft.captions.every(
      (caption) => !caption.text.trim() || caption.end - caption.start >= 0.2,
    )
  );
}

type Edge = "start" | "end";
const EPSILON = 1e-6;
const floorTenth = (value: number) => Math.floor(value * 10 + EPSILON) / 10;
const ceilTenth = (value: number) => Math.ceil(value * 10 - EPSILON) / 10;
export const toTenth = (value: number) => Math.round(value * 10) / 10;

/**
 * Where a cut's edge lands when moved to `seconds`: on a tenth of a second,
 * inside the clip, and leaving at least the shortest piece. Clip lengths are
 * rarely on a tenth, so the limits are rounded towards the kept part (never
 * past what the server accepts) and the clip's own end is kept exactly.
 */
export function clampCut(
  item: { start: number; end: number; clipSeconds: number },
  edge: Edge,
  seconds: number,
) {
  const tenth = toTenth(seconds);
  if (edge === "start")
    return Math.max(0, Math.min(tenth, floorTenth(item.end - MIN_CUT_SECONDS)));
  if (tenth >= item.clipSeconds) return item.clipSeconds;
  return Math.min(
    Math.max(tenth, ceilTenth(item.start + MIN_CUT_SECONDS)),
    item.clipSeconds,
  );
}

export function moveItem<T>(items: T[], from: number, to: number) {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

// Letters, digits, "-" and "_" only: what the server accepts as a key.
const newKey = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

/** A video or picture from the media library as a new piece of the film. */
export function clipFromMedia(media: ProjectMedia): TimelineItem {
  const picture = media.kind === "image";
  // A picture may be shown for up to 30 seconds (mirrors the server).
  const clipSeconds = picture ? 30 : (media.seconds ?? 0);
  return {
    key: newKey("m"),
    kind: picture ? "image" : "video",
    scene: null,
    mediaId: media.id,
    title: media.name,
    clipSeconds,
    start: 0,
    end: picture ? STILL_SECONDS : clipSeconds,
    enabled: true,
    speed: 1,
    videoUrl: picture ? null : media.url,
    thumbnailUrl: media.thumbnailUrl,
  };
}

/** An audio file from the media library laid over the film from its start. */
export function audioFromMedia(media: ProjectMedia): TimelineAudio {
  const clipSeconds = media.seconds ?? 0;
  return {
    key: newKey("a"),
    mediaId: media.id,
    name: media.name,
    clipSeconds,
    offset: 0,
    start: 0,
    end: clipSeconds,
    volume: 1,
    loop: false,
    url: media.url,
    waveformUrl: `${media.url}/waveform`,
  };
}

/** One caption per kept scene that has narration, placed where it plays. */
export function captionsFromNarration(
  project: Project,
  items: TimelineItem[],
): TimelineCaption[] {
  const captions: TimelineCaption[] = [];
  let offset = 0;
  for (const item of items) {
    if (!item.enabled) continue;
    const length = itemSeconds(item);
    const narration = project.scenes
      .find((scene) => scene.number === item.scene)
      ?.narration.trim();
    if (narration)
      captions.push({
        start: toTenth(offset),
        end: toTenth(offset + length),
        text: narration.slice(0, CAPTION_LENGTH),
      });
    offset += length;
  }
  return captions;
}

/** The captions as an SRT file, in time order. */
export function captionsSrt(captions: TimelineCaption[]) {
  const stamp = (seconds: number) => {
    const whole = Math.round(seconds * 1000);
    const part = (value: number, size = 2) => String(value).padStart(size, "0");
    return `${part(Math.floor(whole / 3_600_000))}:${part(Math.floor(whole / 60_000) % 60)}:${part(Math.floor(whole / 1000) % 60)},${part(whole % 1000, 3)}`;
  };
  return [...captions]
    .filter((caption) => caption.text.trim())
    .sort((a, b) => a.start - b.start)
    .map(
      (caption, index) =>
        `${index + 1}\n${stamp(caption.start)} --> ${stamp(caption.end)}\n${caption.text.trim()}\n`,
    )
    .join("\n");
}

export function timelineErrorKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = TIMELINE_ERROR_CODES.find((value) => value === code);
  return known
    ? (`projects.timeline.errors.${known}` as const)
    : "projects.timeline.errors.unknown";
}
