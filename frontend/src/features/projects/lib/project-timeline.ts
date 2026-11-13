import { ApiError } from "@/lib/http";
import { TIMELINE_ERROR_CODES } from "../constants";
import type { TimelineItem } from "../types";

// The shortest piece of a clip that may be kept (mirrors the server).
export const MIN_CUT_SECONDS = 0.5;

/** What the server stores: order, cuts, and which scenes are kept. */
export function timelineCuts(items: TimelineItem[]) {
  return items.map(({ scene, start, end, enabled }) => ({
    scene,
    start,
    end,
    enabled,
  }));
}

export function timelineSeconds(items: TimelineItem[]) {
  return items.reduce(
    (total, item) => total + (item.enabled ? item.end - item.start : 0),
    0,
  );
}

type Edge = "start" | "end";
const EPSILON = 1e-6;
const floorTenth = (value: number) => Math.floor(value * 10 + EPSILON) / 10;
const ceilTenth = (value: number) => Math.ceil(value * 10 - EPSILON) / 10;

/**
 * Where a cut's edge lands when moved to `seconds`: on a tenth of a second,
 * inside the clip, and leaving at least the shortest piece. Clip lengths are
 * rarely on a tenth, so the limits are rounded towards the kept part (never
 * past what the server accepts) and the clip's own end is kept exactly.
 */
export function clampCut(
  item: Pick<TimelineItem, "start" | "end" | "clipSeconds">,
  edge: Edge,
  seconds: number,
) {
  const tenth = Math.round(seconds * 10) / 10;
  if (edge === "start")
    return Math.max(
      0,
      Math.min(tenth, floorTenth(item.end - MIN_CUT_SECONDS)),
    );
  if (tenth >= item.clipSeconds) return item.clipSeconds;
  return Math.min(
    Math.max(tenth, ceilTenth(item.start + MIN_CUT_SECONDS)),
    item.clipSeconds,
  );
}

export function isTimelineValid(items: TimelineItem[]) {
  return (
    items.some((item) => item.enabled) &&
    items.every((item) => item.end - item.start >= MIN_CUT_SECONDS - 1e-6)
  );
}

export function moveItem<T>(items: T[], from: number, to: number) {
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export function timelineErrorKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = TIMELINE_ERROR_CODES.find((value) => value === code);
  return known
    ? (`projects.timeline.errors.${known}` as const)
    : "projects.timeline.errors.unknown";
}
