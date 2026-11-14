import {
  ArrowLeft,
  ArrowRight,
  Film,
  Image,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProjectMedia } from "../api/media";
import { carriesMedia, DRAG_CLIP, droppedMedia } from "../lib/media-drag";
import {
  clampCut,
  fullSeconds,
  itemSeconds,
  SPEEDS,
} from "../lib/project-timeline";
import type { TimelineItem } from "../types";
import { ClipEffectsFields } from "./clip-effects-fields";

const secondsLabel = (value: number) => `${value.toFixed(1)}s`;
const speedLabel = (speed: number) => `${speed}×`;

type Edge = "start" | "end";
type Trim = {
  key: string;
  edge: Edge;
  // Pointer position and the cut when the drag began, with the track's width
  // and scale at that moment (the scale moves while a picture is stretched).
  x: number;
  start: number;
  end: number;
  width: number;
  span: number;
};

// The film's picture track, edited directly as in a video editor: drag a
// clip to move it, drag either edge to trim it. `span` is the number of film
// seconds the full track width stands for, so the track lines up with the
// ruler above it and keeps its scale while a clip is trimmed.
export function TimelineStrip({
  items,
  span,
  selected,
  editable,
  onSelect,
  onMove,
    onTrim,
    onDropMedia,
  onRemove,
  canRemove,
}: {
  items: TimelineItem[];
  span: number;
  selected: string | null;
  editable: boolean;
  onSelect: (key: string) => void;
  onMove: (from: number, to: number) => void;
  onTrim: (key: string, edge: Edge, seconds: number) => void;
  // A video or picture dragged in from the media library, with the
  // position among `items` it was dropped at.
  onDropMedia?: (media: ProjectMedia, index: number) => void;
  // Take a piece out of the film: one the user added, or a part of a
  // scene that still has another part in it.
  onRemove?: (key: string) => void;
  canRemove?: (item: TimelineItem) => boolean;
}) {
  const { t } = useTranslation();
  const track = useRef<HTMLOListElement>(null);
  // Where a card from the media library would land.
  const [insert, setInsert] = useState<number | null>(null);
  const [dragged, setDragged] = useState<number | null>(null);
  const [target, setTarget] = useState<number | null>(null);
  const [trim, setTrim] = useState<Trim | null>(null);
  // Read by dragstart, which fires before the trim state has rendered.
  const trimming = useRef(false);

  function beginTrim(
    event: React.PointerEvent,
    item: TimelineItem,
    edge: Edge,
  ) {
    // Only the main button trims; a right-click opens the context menu.
    if (!editable || !track.current || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    trimming.current = true;
    onSelect(item.key);
    setTrim({
      key: item.key,
      edge,
      x: event.clientX,
      start: item.start,
      end: item.end,
      width: track.current.getBoundingClientRect().width,
      span,
    });
  }

  function moveTrim(event: React.PointerEvent, item: TimelineItem) {
    if (!trim || trim.key !== item.key || trim.width <= 0) return;
    // The pointer moves in film seconds; a faster clip uses up more of its
    // own seconds for the same distance.
    const delta =
      ((event.clientX - trim.x) / trim.width) * trim.span * item.speed;
    const seconds = clampCut(item, trim.edge, trim[trim.edge] + delta);
    if (seconds !== item[trim.edge]) onTrim(item.key, trim.edge, seconds);
  }

  function endTrim() {
    trimming.current = false;
    setTrim(null);
  }

  // Before the first clip whose middle is right of the pointer.
  function insertionAt(x: number) {
    const clips = [...(track.current?.children ?? [])];
    const index = clips.findIndex((clip) => {
      const box = clip.getBoundingClientRect();
      return x < box.left + box.width / 2;
    });
    return index < 0 ? clips.length : index;
  }

  return (
    <ol
      ref={track}
      className="flex"
      onDragOver={(event) => {
        // A clip being reordered is handled by the clip it is over.
        if (dragged !== null || !editable || !onDropMedia) return;
        if (!carriesMedia(event, DRAG_CLIP)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setInsert(insertionAt(event.clientX));
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setInsert(null);
      }}
      onDrop={(event) => {
        setInsert(null);
        if (dragged !== null || !editable || !onDropMedia) return;
        const media = droppedMedia(event, DRAG_CLIP);
        if (!media) return;
        event.preventDefault();
        onDropMedia(media, insertionAt(event.clientX));
      }}
    >
      {items.map((item, index) => {
        const trimmed = trim?.key === item.key ? trim : null;
        const picture = item.kind === "image";
        const Kind = picture ? Image : Film;
        return (
          <li
            key={item.key}
            style={{
              width: `${(itemSeconds(item) / span) * 100}%`,
              // While the head is dragged the clip's left edge follows the
              // pointer; the gap closes when the drag ends.
              marginLeft:
                trimmed?.edge === "start"
                  ? `${((item.start - trimmed.start) / item.speed / span) * 100}%`
                  : undefined,
            }}
            className="relative min-w-0 shrink-0 px-px"
            onDragOver={(event) => {
              if (dragged === null) return;
              event.preventDefault();
              setTarget(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (dragged !== null && dragged !== index) onMove(dragged, index);
              setDragged(null);
              setTarget(null);
            }}
          >
            {(insert === index ||
              (insert === items.length && index === items.length - 1)) && (
              // The gap a dropped file would open.
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute inset-y-0 z-20 w-1 rounded-full bg-primary",
                  insert === index ? "-left-0.5" : "-right-0.5",
                )}
              />
            )}
            <div
              className={cn(
                "group relative h-16 overflow-hidden rounded-md border",
                selected === item.key ? "border-primary" : "border-input",
                dragged === index && "opacity-40",
                target === index && dragged !== index && "ring-2 ring-primary",
              )}
            >
              <button
                type="button"
                draggable={editable}
                aria-pressed={selected === item.key}
                onClick={() => onSelect(item.key)}
                onDragStart={(event) => {
                  if (trimming.current) event.preventDefault();
                  else setDragged(index);
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setTarget(null);
                }}
                className={cn(
                  "absolute inset-0 bg-background text-left",
                  editable && "cursor-grab active:cursor-grabbing",
                )}
              >
                {item.thumbnailUrl && (
                  <img
                    src={item.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                )}
                <span className="absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-black/40" />
                <span className="absolute top-1 left-3 flex items-center gap-1">
                  <span className="grid h-4 min-w-4 place-items-center rounded bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
                    {item.scene ?? (
                      <Kind className="size-2.5" aria-hidden="true" />
                    )}
                  </span>
                  {item.speed !== 1 && (
                    <span className="rounded bg-primary px-1 font-mono text-[10px] leading-4 text-primary-foreground">
                      {speedLabel(item.speed)}
                    </span>
                  )}
                </span>
                <span className="absolute inset-x-3 bottom-1 flex items-end justify-between gap-2 text-white">
                  <span className="min-w-0 truncate text-[11px] font-medium">
                    {item.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px]">
                    {secondsLabel(itemSeconds(item))}
                  </span>
                </span>
              </button>
              {editable && onRemove && (canRemove?.(item) ?? item.mediaId !== null) && (
                // Only what the user added can go; a scene is left out instead.
                <button
                  type="button"
                  title={t("projects.timeline.remove")}
                  aria-label={t("projects.timeline.remove")}
                  onClick={() => onRemove(item.key)}
                  className={cn(
                    "absolute top-1 right-3.5 z-20 grid size-4.5 place-items-center rounded bg-black/70 text-white opacity-0 group-hover:opacity-100 hover:bg-destructive focus-visible:opacity-100",
                    selected === item.key && "opacity-100",
                  )}
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
              {editable &&
                // A picture has no beginning to cut: only how long it shows.
                (picture ? (["end"] as const) : (["start", "end"] as const)).map(
                  (edge) => (
                    // Trim handles are pointer-only; the cut editor offers the
                    // same change with exact numbers and the keyboard.
                    <span
                      key={edge}
                      aria-hidden="true"
                      onPointerDown={(event) => beginTrim(event, item, edge)}
                      onPointerMove={(event) => moveTrim(event, item)}
                      onPointerUp={endTrim}
                      onPointerCancel={endTrim}
                      // The capture can end without a pointerup (a context
                      // menu, the window losing focus): never stay in a trim.
                      onLostPointerCapture={endTrim}
                      className={cn(
                        "absolute inset-y-0 z-10 flex w-2.5 cursor-ew-resize touch-none items-center justify-center bg-black/40",
                        edge === "start" ? "left-0" : "right-0",
                        trimmed?.edge === edge
                          ? "bg-primary"
                          : "opacity-0 group-hover:opacity-100",
                        selected === item.key && "opacity-100",
                      )}
                    >
                      <span className="h-6 w-0.5 rounded-full bg-white/80" />
                    </span>
                  ),
                )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// A number of seconds. While it is typed the text is kept as it is ("1" on
// the way to "10"); the value follows as soon as the number fits, and leaving
// the field or Enter settles it on the nearest value that does.
export function SecondsInput({
  id,
  value,
  max,
  fit,
  onCommit,
  className,
  ...rest
}: {
  id?: string;
  value: number;
  max?: number;
  // The nearest allowed value to what was typed.
  fit: (seconds: number) => number;
  onCommit: (seconds: number) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function settle() {
    const typed = Number.parseFloat(draft ?? "");
    if (!Number.isNaN(typed)) onCommit(fit(typed));
    setDraft(null);
  }

  return (
    <Input
      {...rest}
      id={id}
      type="number"
      min={0}
      max={max}
      step={0.1}
      value={draft ?? value}
      onChange={(event) => {
        const raw = event.target.value;
        const typed = Number.parseFloat(raw);
        const fits = !Number.isNaN(typed) && fit(typed) === typed;
        if (fits) onCommit(typed);
        // Text that already is the value needs no draft: the field shows it.
        setDraft(fits && String(typed) === raw ? null : raw);
      }}
      onBlur={settle}
      onKeyDown={(event) => {
        if (event.key === "Enter") settle();
      }}
      className={cn("h-9 font-mono", className)}
    />
  );
}

// Trim, speed, position and inclusion of the selected piece, with exact
// numbers.
export function TimelineCutEditor({
  item,
  index,
  count,
  editable,
  onChange,
  onMove,
  onRemove,
}: {
  item: TimelineItem;
  index: number;
  count: number;
  editable: boolean;
  onChange: (patch: Partial<TimelineItem>) => void;
  onMove: (from: number, to: number) => void;
  // Given for a piece the user added; a scene can only be left out.
  onRemove?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const picture = item.kind === "image";

  return (
    <fieldset disabled={!editable} className="min-w-0 space-y-4">
      <legend className="mb-1 w-full text-sm font-semibold">
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
            <Scissors className="size-4" aria-hidden="true" />
          </span>
          {t("projects.timeline.cut")}
        </span>
      </legend>
      <p
        className="line-clamp-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground"
        title={item.title}
      >
        {item.scene === null
          ? item.title
          : `${t("projects.details.scene", { number: item.scene })} · ${item.title}`}
      </p>
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-background/50 p-3">
        {(picture ? (["end"] as const) : (["start", "end"] as const)).map(
          (edge) => (
            <div
              key={edge}
              className={cn("min-w-0 space-y-2", picture && "col-span-2")}
            >
              <Label htmlFor={`${id}-${edge}`} className="text-xs">
                {t(
                  picture
                    ? "projects.timeline.shown"
                    : `projects.timeline.${edge}`,
                )}
              </Label>
              <SecondsInput
                id={`${id}-${edge}`}
                value={item[edge]}
                max={item.clipSeconds}
                fit={(seconds) => clampCut(item, edge, seconds)}
                onCommit={(seconds) => onChange({ [edge]: seconds })}
              />
            </div>
          ),
        )}
        {!picture && (
          <div className="col-span-2 space-y-2 border-t pt-3">
            <span id={`${id}-speed`} className="block text-xs font-medium">
              {t("projects.timeline.speed")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-speed`}
              className="grid grid-cols-3 gap-1.5"
            >
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  type="button"
                  role="radio"
                  aria-checked={item.speed === speed}
                  onClick={() => onChange({ speed })}
                  className={cn(
                    "h-9 rounded-lg border px-2 font-mono text-xs transition-colors disabled:opacity-50",
                    item.speed === speed
                      ? "border-primary bg-primary-soft text-primary"
                      : "border-transparent bg-secondary text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {speedLabel(speed)}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <p className="text-xs leading-5 text-faint">
        {picture
          ? t("projects.timeline.pictureLength")
          : t("projects.timeline.clipLength", {
              seconds: item.clipSeconds.toFixed(1),
            })}
        {item.speed !== 1 &&
          ` ${t("projects.timeline.playsFor", {
            seconds: itemSeconds(item).toFixed(1),
            full: fullSeconds(item).toFixed(1),
          })}`}
      </p>
      <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border bg-background/50 p-3 text-[13px] leading-5">
        <input
          type="checkbox"
          checked={item.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          className="size-4 shrink-0 accent-primary"
        />
        {t("projects.timeline.include")}
      </label>
      <div className="border-t pt-3">
        <ClipEffectsFields item={item} onChange={onChange} />
      </div>
      <div className="grid grid-cols-2 gap-2 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={index === 0}
          onClick={() => onMove(index, index - 1)}
        >
          <ArrowLeft aria-hidden="true" />
          {t("projects.timeline.earlier")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={index === count - 1}
          onClick={() => onMove(index, index + 1)}
        >
          {t("projects.timeline.later")}
          <ArrowRight aria-hidden="true" />
        </Button>
        {onRemove && (
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="col-span-2"
            onClick={onRemove}
          >
            <Trash2 aria-hidden="true" />
            {t("projects.timeline.remove")}
          </Button>
        )}
      </div>
    </fieldset>
  );
}
