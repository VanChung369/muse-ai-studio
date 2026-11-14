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
  | "items"
  | "audio"
  | "volume"
  | "duck"
  | "captions"
  | "burnCaptions"
  | "captionStyle"
  | "titles"
  | "logo"
  | "output"
>;

// A clip as it comes: no look, no zoom, no fades.
const PLAIN_LOOK = {
  effect: "none",
  zoom: "none",
  flip: false,
  fadeIn: 0,
  fadeOut: 0,
} as const;

export const EMPTY_DRAFT: TimelineDraft = {
  items: [],
  audio: [],
  volume: 1,
  duck: false,
  captions: [],
  burnCaptions: true,
  captionStyle: {
    size: "medium",
    color: "#FFFFFF",
    outline: "#000000",
    position: "bottom",
    bold: false,
    box: false,
    font: "Arial",
  },
  titles: [],
  logo: null,
  output: { aspect: "source", fit: "contain", height: 0, quality: "high" },
};

export function draftOf(timeline: ProjectTimeline | undefined): TimelineDraft {
  if (!timeline) return EMPTY_DRAFT;
  return {
    items: timeline.items,
    audio: timeline.audio,
    volume: timeline.volume,
    duck: timeline.duck,
    captions: timeline.captions,
    burnCaptions: timeline.burnCaptions,
    captionStyle: timeline.captionStyle,
    titles: timeline.titles,
    logo: timeline.logo,
    output: timeline.output,
  };
}

/** What the server stores: the edit without what it derives itself. */
export function timelinePayload(draft: TimelineDraft): TimelinePayload {
  return {
    items: draft.items.map((item) => {
      const cut = {
        key: item.key,
        start: item.start,
        end: item.end,
        enabled: item.enabled,
        speed: item.speed,
        effect: item.effect,
        zoom: item.zoom,
        flip: item.flip,
        fadeIn: item.fadeIn,
        fadeOut: item.fadeOut,
      };
      return item.mediaId === null
        ? { scene: item.scene ?? 0, ...cut }
        : { mediaId: item.mediaId, ...cut };
    }),
    audio: draft.audio.map(
      ({ mediaId, key, offset, start, end, volume, loop, fadeIn, fadeOut }) => ({
        mediaId,
        key,
        offset,
        start,
        end,
        volume,
        loop,
        fadeIn,
        fadeOut,
      }),
    ),
    volume: draft.volume,
    duck: draft.duck,
    captions: draft.captions
      .filter((caption) => caption.text.trim())
      .map(({ start, end, text }) => ({ start, end, text })),
    burnCaptions: draft.burnCaptions,
    captionStyle: draft.captionStyle,
    titles: draft.titles.filter((title) => title.text.trim()),
    logo: draft.logo && {
      mediaId: draft.logo.mediaId,
      corner: draft.logo.corner,
      size: draft.logo.size,
      opacity: draft.logo.opacity,
    },
    output: draft.output,
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
  const shown = (piece: { start: number; end: number; text: string }) =>
    !piece.text.trim() || piece.end - piece.start >= 0.2;
  return (
    draft.items.some((item) => item.enabled) &&
    draft.items.every(long) &&
    draft.audio.every(long) &&
    draft.captions.every(shown) &&
    draft.titles.every(shown)
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
    ...PLAIN_LOOK,
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
    fadeIn: 0,
    fadeOut: 0,
    url: media.url,
    waveformUrl: `${media.url}/waveform`,
  };
}

/**
 * The pieces after cutting one in two at `at` seconds into its clip, or null
 * when either half would be shorter than the shortest piece. The first half
 * keeps the fade in, the second the fade out.
 */
export function splitItem(items: TimelineItem[], key: string, at: number) {
  const index = items.findIndex((item) => item.key === key);
  const item = items[index];
  if (!item || item.kind === "image") return null;
  const cut = toTenth(at);
  if (
    cut - item.start < MIN_CUT_SECONDS - EPSILON ||
    item.end - cut < MIN_CUT_SECONDS - EPSILON
  )
    return null;
  const second = {
    ...item,
    key: newKey(item.scene === null ? "m" : `scene-${item.scene}`),
    start: cut,
    fadeIn: 0,
  };
  return {
    items: [
      ...items.slice(0, index),
      { ...item, end: cut, fadeOut: 0 },
      second,
      ...items.slice(index + 1),
    ],
    second: second.key,
  };
}

/** Whether a piece may be taken out altogether, rather than only left out. */
export function isRemovable(items: TimelineItem[], item: TimelineItem) {
  // A scene must keep one piece in the timeline; added media need none.
  return (
    item.mediaId !== null ||
    items.filter((other) => other.scene === item.scene).length > 1
  );
}

type Placed = { key: string; offset: number; length: number };

/** Where each kept piece sits in the film. */
export function filmLayout(items: TimelineItem[]): Placed[] {
  let offset = 0;
  return items
    .filter((item) => item.enabled)
    .map((item) => {
      const placed = { key: item.key, offset, length: itemSeconds(item) };
      offset += placed.length;
      return placed;
    });
}

/** Times in the film worth snapping to: where each piece begins and ends. */
export function snapPoints(items: TimelineItem[]) {
  const layout = filmLayout(items);
  return [0, ...layout.map((piece) => piece.offset + piece.length)];
}

/**
 * Captions or titles moved along with the pieces they sit on: each stays on
 * the piece that was playing when it started, as far into it as before.
 * One whose piece is gone, or that was past the end of the film, stays put.
 */
export function followClips<T extends { start: number; end: number }>(
  timed: T[],
  before: TimelineItem[],
  after: TimelineItem[],
): T[] {
  const old = filmLayout(before);
  const known = new Set(before.map((item) => item.key));
  const kept = after.filter((item) => item.enabled);
  const now = new Map<string, Placed>();
  let offset = 0;
  kept.forEach((item, index) => {
    const placed = { key: item.key, offset, length: itemSeconds(item) };
    offset += placed.length;
    // A piece just cut in two plays exactly as before: its halves count as
    // the one piece, so what sat on the second half is not pulled back.
    const half = kept[index + 1];
    if (
      half &&
      known.has(item.key) &&
      !known.has(half.key) &&
      half.kind !== "image" &&
      half.scene === item.scene &&
      half.mediaId === item.mediaId &&
      half.speed === item.speed &&
      Math.abs(half.start - item.end) < EPSILON
    )
      placed.length += itemSeconds(half);
    now.set(item.key, placed);
  });
  return timed.map((entry) => {
    const from = old.find(
      (piece) =>
        entry.start >= piece.offset - EPSILON &&
        entry.start < piece.offset + piece.length - EPSILON,
    );
    const to = from && now.get(from.key);
    if (!from || !to) return entry;
    // The same share of the way into the piece, so a trim or a new speed
    // keeps the words on the same moment.
    const share = from.length > 0 ? (entry.start - from.offset) / from.length : 0;
    const start = toTenth(to.offset + share * to.length);
    return start === entry.start
      ? entry
      : { ...entry, start, end: toTenth(start + entry.end - entry.start) };
  });
}

/** One caption per kept scene that has narration, placed where it plays. */
export function captionsFromNarration(
  project: Project,
  items: TimelineItem[],
): TimelineCaption[] {
  const captions: TimelineCaption[] = [];
  const told = new Set<number>();
  let offset = 0;
  for (const item of items) {
    if (!item.enabled) continue;
    const length = itemSeconds(item);
    const narration = project.scenes
      .find((scene) => scene.number === item.scene)
      ?.narration.trim();
    // A scene cut in pieces is narrated once, over its first piece.
    if (narration && item.scene !== null && !told.has(item.scene)) {
      told.add(item.scene);
      captions.push({
        start: toTenth(offset),
        end: toTenth(offset + length),
        text: narration.slice(0, CAPTION_LENGTH),
      });
    }
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
