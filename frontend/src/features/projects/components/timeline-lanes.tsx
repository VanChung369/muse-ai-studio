import {
  AudioLines,
  Captions,
  Download,
  Plus,
  Repeat,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_AUDIO_FADE } from "../lib/clip-effects";
import {
  audioSeconds,
  CAPTION_LENGTH,
  clampCut,
  MAX_CAPTIONS,
  toTenth,
} from "../lib/project-timeline";
import {
  CAPTION_FONTS,
  CAPTION_POSITIONS,
  CAPTION_SIZES,
  type CaptionStyle,
} from "../api/timeline";
import type { TimelineAudio, TimelineCaption } from "../types";
import { SecondsInput } from "./studio-timeline";

const percent = (value: number) => `${Math.round(value * 100)}%`;
const secondsLabel = (value: number) => `${value.toFixed(1)}s`;

type Edge = "start" | "end";
// What dragging a block's edge does: `onBegin` when a drag starts, then
// `onDrag` with the film seconds the pointer has moved since.
type Resize = {
  onBegin: () => void;
  onDrag: (edge: Edge, seconds: number) => void;
};

// An edge of a block, dragged to trim it as on the picture track.
function Handle({
  edge,
  span,
  resize,
}: {
  edge: Edge;
  span: number;
  resize: Resize;
}) {
  // Pointer position and lane width when the drag began.
  const from = useRef<{ x: number; width: number } | null>(null);
  const end = () => (from.current = null);

  return (
    <span
      aria-hidden="true"
      onPointerDown={(event) => {
        const lane = event.currentTarget.closest("[data-lane]");
        if (!lane || event.button !== 0) return;
        // The block itself must not start moving.
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        from.current = {
          x: event.clientX,
          width: lane.getBoundingClientRect().width,
        };
        resize.onBegin();
      }}
      onPointerMove={(event) => {
        const start = from.current;
        if (!start || start.width <= 0) return;
        resize.onDrag(edge, ((event.clientX - start.x) / start.width) * span);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      className={cn(
        "absolute inset-y-0 z-10 flex w-3 cursor-ew-resize touch-none items-center justify-center bg-black/45 opacity-0 group-hover/block:opacity-100 group-aria-pressed/block:opacity-100 hover:bg-primary hover:text-primary-foreground",
        edge === "start" ? "left-0" : "right-0",
      )}
    >
      <span className="h-4 w-0.5 rounded-full bg-current" />
    </span>
  );
}

// A block on a lane of the timeline: something that sits at a time in the
// film. Dragging it sideways moves that time and dragging an edge trims it;
// `span` is the number of film seconds the lane's full width stands for.
function LaneBlock({
  at,
  length,
    span,
  limit,
  snaps,
  selected,
  editable,
  label,
  onSelect,
  onShift,
  resize,
  className,
  children,
}: {
  at: number;
  length: number;
  span: number;
  // The latest time the block may start at.
  limit: number;
  // Times in the film its start or end is drawn to when dragged close.
  snaps?: readonly number[];
  selected: boolean;
  editable: boolean;
  label: string;
  onSelect: () => void;
  onShift: (seconds: number) => void;
  // Absent when the block's edges cannot be dragged.
  resize?: Resize;
  className?: string;
  children: React.ReactNode;
}) {
  // Pointer position, start time and lane width when the drag began.
  const drag = useRef<{ x: number; at: number; width: number } | null>(null);

  return (
    <button
      type="button"
      aria-pressed={selected}
      title={label}
      style={{
        left: `${Math.min(at / span, 1) * 100}%`,
        width: `${Math.max((length / span) * 100, 0.6)}%`,
      }}
      onClick={onSelect}
      onPointerDown={(event) => {
        const lane = event.currentTarget.parentElement;
        if (!editable || !lane || event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {
          x: event.clientX,
          at,
          width: lane.getBoundingClientRect().width,
        };
        onSelect();
      }}
      onPointerMove={(event) => {
        const from = drag.current;
        if (!from || from.width <= 0) return;
        const moved = ((event.clientX - from.x) / from.width) * span;
        let next = toTenth(from.at + moved);
        // Within a few pixels of a cut, sit exactly on it, by either end.
        const reach = (8 / from.width) * span;
        for (const point of snaps ?? []) {
          if (Math.abs(next - point) <= reach) next = toTenth(point);
          else if (Math.abs(next + length - point) <= reach)
            next = toTenth(point - length);
          else continue;
          break;
        }
        next = Math.min(Math.max(next, 0), limit);
        if (next !== at) onShift(next);
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onLostPointerCapture={() => (drag.current = null)}
      className={cn(
        "group/block absolute inset-y-0.5 flex min-w-0 touch-none items-center gap-1.5 overflow-hidden rounded border px-4 text-left text-[11px]",
        selected ? "border-primary" : "border-transparent",
        editable && "cursor-grab active:cursor-grabbing",
        className,
      )}
    >
      {children}
      {editable && resize && (
        <>
          <Handle edge="start" span={span} resize={resize} />
          <Handle edge="end" span={span} resize={resize} />
        </>
      )}
    </button>
  );
}

function Lane({
  tall = false,
  children,
}: {
  tall?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      data-lane
      className={cn(
        "relative overflow-hidden rounded-md border border-input bg-background",
        tall ? "h-12" : "h-8",
      )}
    >
      {children}
    </div>
  );
}

// One lane per audio file laid over the film. A piece is dragged to move it
// and by its edges to trim it, like a clip on the picture track.
export function AudioLanes({
  tracks,
  total,
  span,
  selected,
  editable,
    onSelect,
  onChange,
  snaps,
}: {
  tracks: TimelineAudio[];
  // Length of the film: audio stops where it ends.
  total: number;
  span: number;
  selected: string | null;
  editable: boolean;
  onSelect: (key: string) => void;
  onChange: (key: string, patch: Partial<TimelineAudio>) => void;
  snaps?: readonly number[];
}) {
  // The piece as it was when an edge drag began, with how much of it showed.
  const origin = useRef<(TimelineAudio & { shown: number }) | null>(null);

  return (
    <div className="space-y-1">
      {tracks.map((track) => (
        <Lane key={track.key} tall>
          <LaneBlock
            at={track.offset}
            length={audioSeconds(track, total)}
            span={span}
            limit={Math.max(toTenth(total - 0.5), 0)}
            snaps={snaps}
            selected={selected === track.key}
            editable={editable}
            label={track.name}
            onSelect={() => onSelect(track.key)}
            onShift={(offset) => onChange(track.key, { offset })}
            // A repeated piece fills the film: its edges are not its ends.
            resize={
              track.loop
                ? undefined
                : {
                    onBegin: () => {
                      origin.current = {
                        ...track,
                        shown: audioSeconds(track, total),
                      };
                      onSelect(track.key);
                    },
                    onDrag: (edge, seconds) => {
                      const from = origin.current;
                      if (!from || from.key !== track.key) return;
                      if (edge === "end") {
                        // From where the piece visibly ends: the film may
                        // already cut it short.
                        const end = clampCut(
                          from,
                          "end",
                          from.start + from.shown + seconds,
                        );
                        if (end !== track.end) onChange(track.key, { end });
                        return;
                      }
                      // The head moves with its sound: what is cut off the
                      // start is also where the piece now begins in the film,
                      // which cannot be before the film does.
                      const wanted = from.start + seconds;
                      const start = Math.max(
                        clampCut(from, "start", wanted),
                        toTenth(from.start - from.offset),
                      );
                      // Pulled past the file's first second, there is no
                      // earlier sound to uncover: the piece moves earlier.
                      const offset = Math.max(
                        toTenth(
                          from.offset + start - from.start + Math.min(wanted, 0),
                        ),
                        0,
                      );
                      if (start !== track.start || offset !== track.offset)
                        onChange(track.key, { start, offset });
                    },
                  }
            }
            className="items-start bg-running-soft pt-1 text-running"
          >
            {!track.loop && audioSeconds(track, total) > 0 && (
              // The file's sound drawn to scale: the piece is a window on it,
              // so trimming shows which part is kept.
              <img
                src={track.waveformUrl}
                alt=""
                draggable={false}
                style={{
                  left: `${(-track.start / audioSeconds(track, total)) * 100}%`,
                  width: `${(track.clipSeconds / audioSeconds(track, total)) * 100}%`,
                }}
                onError={(event) => {
                  event.currentTarget.hidden = true;
                }}
                className="pointer-events-none absolute top-5 h-[calc(100%-1.5rem)] max-w-none opacity-60"
              />
            )}
            {track.loop ? (
              <Repeat className="relative size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <AudioLines
                className="relative size-3.5 shrink-0"
                aria-hidden="true"
              />
            )}
            <span className="relative min-w-0 truncate font-medium">
              {track.name}
            </span>
            <span className="relative ml-auto shrink-0 rounded bg-black/40 px-1 font-mono text-[10px] leading-4">
              {secondsLabel(audioSeconds(track, total))} ·{" "}
              {percent(track.volume)}
            </span>
          </LaneBlock>
        </Lane>
      ))}
    </div>
  );
}

function VolumeField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (volume: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center justify-between text-xs">
        {label}
        <span className="font-mono text-muted-foreground">
          {percent(value)}
        </span>
      </Label>
      <input
        id={id}
        type="range"
        min={0}
        max={2}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
    </div>
  );
}

// How loud the sound the clips came with is, under any audio added on top.
export function SceneVolume({
  volume,
  muted,
  editable,
  onChange,
}: {
  volume: number;
  // The project is set to silent scenes: this volume has nothing to act on.
  muted: boolean;
  editable: boolean;
  onChange: (volume: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <fieldset disabled={!editable || muted} className="min-w-0 space-y-1.5">
      <VolumeField
        id={id}
        label={t("projects.timeline.sceneVolume")}
        value={muted ? 0 : volume}
        onChange={onChange}
      />
      {muted && (
        <p className="text-xs leading-5 text-faint">
          {t("projects.timeline.sceneVolumeMuted")}
        </p>
      )}
    </fieldset>
  );
}

// Placement, the part used, volume and repeat of the selected audio.
export function AudioEditor({
  track,
  total,
  editable,
  onChange,
  onRemove,
}: {
  track: TimelineAudio;
  total: number;
  editable: boolean;
  onChange: (patch: Partial<TimelineAudio>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <fieldset disabled={!editable} className="min-w-0 space-y-4">
      <legend className="mb-1 w-full text-sm font-semibold">
        <span className="flex items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-running-soft text-running">
            <AudioLines className="size-4" aria-hidden="true" />
          </span>
          {t("projects.timeline.audio.title")}
        </span>
      </legend>
      <p
        className="line-clamp-2 rounded-lg bg-secondary/60 px-3 py-2 text-xs leading-5 text-muted-foreground"
        title={track.name}
      >
        {track.name}
      </p>
      <audio
        controls
        preload="metadata"
        src={track.url}
        className="h-9 w-full min-w-0"
      />
      <div className="grid grid-cols-2 gap-3 rounded-lg border bg-background/50 p-3">
        <div className="col-span-2 space-y-2 border-b pb-3">
          <Label htmlFor={`${id}-offset`} className="text-xs">
            {t("projects.timeline.audio.offset")}
          </Label>
          <SecondsInput
            id={`${id}-offset`}
            value={track.offset}
            fit={(seconds) =>
              Math.min(
                Math.max(toTenth(seconds), 0),
                Math.max(toTenth(total - 0.5), 0),
              )
            }
            onCommit={(offset) => onChange({ offset })}
          />
        </div>
        {(["start", "end"] as const).map((edge) => (
          <div key={edge} className="min-w-0 space-y-2">
            <Label htmlFor={`${id}-${edge}`} className="text-xs">
              {t(`projects.timeline.audio.${edge}`)}
            </Label>
            <SecondsInput
              id={`${id}-${edge}`}
              value={track[edge]}
              max={track.clipSeconds}
              fit={(seconds) => clampCut(track, edge, seconds)}
              onCommit={(seconds) => onChange({ [edge]: seconds })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs leading-5 text-faint">
        {t("projects.timeline.audio.length", {
          seconds: track.clipSeconds.toFixed(1),
        })}
      </p>
      <div className="rounded-lg border bg-background/50 p-3">
        <VolumeField
          id={`${id}-volume`}
          label={t("projects.timeline.audio.volume")}
        value={track.volume}
        onChange={(volume) => onChange({ volume })}
      />
      <div className="grid grid-cols-2 gap-3">
        <SecondsRange
          label={t("projects.timeline.audio.fadeIn")}
          value={track.fadeIn}
          max={MAX_AUDIO_FADE}
          onChange={(fadeIn) => onChange({ fadeIn })}
        />
        <SecondsRange
          label={t("projects.timeline.audio.fadeOut")}
          value={track.fadeOut}
          max={MAX_AUDIO_FADE}
          onChange={(fadeOut) => onChange({ fadeOut })}
        />
      </div>
      </div>
      <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-background/50 p-3 text-[13px]">
        <input
          type="checkbox"
          checked={track.loop}
          onChange={(event) => onChange({ loop: event.target.checked })}
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span>
          {t("projects.timeline.audio.loop")}
          <span className="block text-xs leading-5 text-faint">
            {t("projects.timeline.audio.loopHint")}
          </span>
        </span>
      </label>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        className="w-full"
        onClick={onRemove}
      >
        <Trash2 aria-hidden="true" />
        {t("projects.timeline.remove")}
      </Button>
    </fieldset>
  );
}

// The captions along the film; drag one to move it, or its edges to change
// when it shows and hides.
export function CaptionLane({
  captions,
  span,
  selected,
  editable,
    onSelect,
  onChange,
  snaps,
  tone = "bg-primary-soft text-primary",
}: {
  captions: TimelineCaption[];
  span: number;
  selected: number | null;
  editable: boolean;
  onSelect: (index: number) => void;
  onChange: (index: number, patch: Partial<TimelineCaption>) => void;
  snaps?: readonly number[];
  // Colours of the blocks, so a lane of titles reads apart from captions.
  tone?: string;
}) {
  // The caption as it was when an edge drag began.
  const origin = useRef<(TimelineCaption & { index: number }) | null>(null);

  return (
    <Lane>
      {captions.map((caption, index) => (
        <LaneBlock
          // Captions have no identity but their place in the list.
          key={index}
          at={caption.start}
          length={caption.end - caption.start}
          span={span}
          // The whole block stays inside the longest film the server takes.
          limit={Math.max(toTenth(3600 - (caption.end - caption.start)), 0)}
          snaps={snaps}
          selected={selected === index}
          editable={editable}
          label={caption.text}
          onSelect={() => onSelect(index)}
          // Moved as a whole: it keeps its length.
          onShift={(start) =>
            onChange(index, {
              start,
              end: toTenth(start + caption.end - caption.start),
            })
          }
          resize={{
            onBegin: () => {
              origin.current = { ...caption, index };
              onSelect(index);
            },
            onDrag: (edge, seconds) => {
              const from = origin.current;
              if (!from || from.index !== index) return;
              onChange(
                index,
                edge === "start"
                  ? {
                      start: Math.min(
                        Math.max(toTenth(from.start + seconds), 0),
                        toTenth(from.end - 0.2),
                      ),
                    }
                  : {
                      end: Math.min(
                        Math.max(
                          toTenth(from.end + seconds),
                          toTenth(from.start + 0.2),
                        ),
                        3600,
                      ),
                    },
              );
            },
          }}
          className={tone}
        >
          <span className="min-w-0 truncate">{caption.text || "…"}</span>
        </LaneBlock>
      ))}
    </Lane>
  );
}

// The captions as a list: when each shows, what it says, how they look, and
// whether they are drawn into the picture.
export function CaptionEditor({
  captions,
  burn,
  canBurn,
  selected,
  editable,
  at,
  onChange,
  onBurn,
  style,
  onStyle,
  onSelect,
  onFromNarration,
  onDownload,
}: {
  captions: TimelineCaption[];
  burn: boolean;
  // False when the server's FFmpeg cannot draw captions.
  canBurn: boolean;
  selected: number | null;
  editable: boolean;
  // Where a new caption starts: where the film is playing.
  at: number;
  onChange: (captions: TimelineCaption[]) => void;
  onBurn: (burn: boolean) => void;
  // How the captions look when drawn into the video.
  style: CaptionStyle;
  onStyle: (patch: Partial<CaptionStyle>) => void;
  onSelect: (index: number | null) => void;
  // Absent when no scene in the film has narration to start from.
  onFromNarration?: () => void;
  onDownload: () => void;
}) {
  const { t } = useTranslation();
  const written = captions.some((caption) => caption.text.trim());
  const drawn = burn && canBurn;

  function patch(index: number, change: Partial<TimelineCaption>) {
    onChange(
      captions.map((caption, position) =>
        position === index ? { ...caption, ...change } : caption,
      ),
    );
  }

  return (
    <fieldset disabled={!editable} className="min-w-0 space-y-3">
      <legend className="sr-only">
        {t("projects.timeline.captions.title")}
      </legend>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={captions.length >= MAX_CAPTIONS}
          onClick={() => {
            const start = toTenth(at);
            onChange([...captions, { start, end: start + 2, text: "" }]);
            onSelect(captions.length);
          }}
        >
          <Plus aria-hidden="true" />
          {t("projects.timeline.captions.add")}
        </Button>
        {onFromNarration && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onFromNarration}
          >
            <Sparkles aria-hidden="true" />
            {t("projects.timeline.captions.fromNarration")}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!written}
          onClick={onDownload}
        >
          <Download aria-hidden="true" />
          {t("projects.timeline.captions.download")}
        </Button>
        {captions.length > 0 && (
          <span className="ml-auto text-xs text-faint">
            {t("projects.timeline.captions.count", { count: captions.length })}
          </span>
        )}
      </div>

      {captions.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-6 py-10 text-center">
          <Captions className="size-6 text-faint" aria-hidden="true" />
          <p className="max-w-sm text-[13px] leading-6 text-muted-foreground">
            {t("projects.timeline.captions.empty")}
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 desktop:grid-cols-[minmax(0,1fr)_19rem]">
          <div className="min-w-0 overflow-hidden rounded-lg border">
            {/* Column names, lined up with the rows below. */}
            <div
              aria-hidden="true"
              className={cn(
                ROW,
                "border-b bg-background px-2.5 py-2 text-[11px] font-medium text-faint max-tablet:hidden",
              )}
            >
              <span className="text-center">#</span>
              <span>{t("projects.timeline.captions.start")}</span>
              <span>{t("projects.timeline.captions.end")}</span>
              <span>{t("projects.timeline.captions.text")}</span>
              <span className="w-7.5" />
            </div>
            <ol className="scroll-subtle max-h-[26rem] divide-y overflow-y-auto">
              {captions.map((caption, index) => (
                <li
                  key={index}
                  onFocusCapture={() => onSelect(index)}
                  className={cn(
                    ROW,
                    "items-start px-2.5 py-2",
                    selected === index
                      ? "bg-primary-soft shadow-[inset_2px_0_0_var(--color-primary)]"
                      : "hover:bg-background",
                  )}
                >
                  <span className="grid h-8 place-items-center font-mono text-[11px] text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <SecondsInput
                    aria-label={t("projects.timeline.captions.start")}
                    value={caption.start}
                    fit={(seconds) =>
                      Math.min(
                        Math.max(toTenth(seconds), 0),
                        toTenth(caption.end - 0.2),
                      )
                    }
                    onCommit={(start) => patch(index, { start })}
                    className="h-8 px-2 text-xs"
                  />
                  <SecondsInput
                    aria-label={t("projects.timeline.captions.end")}
                    value={caption.end}
                    fit={(seconds) =>
                      Math.min(
                        Math.max(toTenth(seconds), toTenth(caption.start + 0.2)),
                        3600,
                      )
                    }
                    onCommit={(end) => patch(index, { end })}
                    className="h-8 px-2 text-xs"
                  />
                  {/* Grows with its text, so a long line is read in full. */}
                  <Textarea
                    aria-label={t("projects.timeline.captions.text")}
                    value={caption.text}
                    rows={1}
                    spellCheck={false}
                    maxLength={CAPTION_LENGTH}
                    placeholder={t("projects.timeline.captions.placeholder")}
                    onChange={(event) =>
                      patch(index, { text: event.target.value })
                    }
                    className="min-h-8 resize-none px-2.5 py-1.5 text-[13px] leading-5 max-tablet:col-span-full max-tablet:row-start-2 md:text-[13px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t("projects.timeline.captions.remove")}
                    onClick={() => {
                      onChange(
                        captions.filter((_, position) => position !== index),
                      );
                      onSelect(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ol>
          </div>

          <div className="min-w-0 space-y-3">
            <label className="flex items-start gap-2 rounded-lg border p-3 text-[13px]">
              <input
                type="checkbox"
                checked={drawn}
                disabled={!canBurn}
                onChange={(event) => onBurn(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-primary"
              />
              <span>
                <span className="font-medium">
                  {t("projects.timeline.captions.burn")}
                </span>
                <span className="block text-xs leading-5 text-faint">
                  {t(
                    canBurn
                      ? "projects.timeline.captions.burnHint"
                      : "projects.timeline.captions.cannotBurn",
                  )}
                </span>
              </span>
            </label>
            {drawn && (
              <CaptionStyleFields
                style={style}
                sample={
                  captions[selected ?? 0]?.text ||
                  captions.find((caption) => caption.text.trim())?.text ||
                  ""
                }
                onChange={onStyle}
              />
            )}
          </div>
        </div>
      )}
    </fieldset>
  );
}

// One caption per row: number, start, end, text, delete. On a narrow screen
// the text takes a line of its own.
const ROW =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 tablet:grid-cols-[1.5rem_5rem_5rem_minmax(0,1fr)_auto]";

// Colours offered for captions next to the free choice.
const SWATCHES = ["#FFFFFF", "#FFE000", "#00E5FF", "#7CFF6B", "#FF5A5A", "#000000"];
// Letter height as a share of the frame's height (mirrors the server).
const SIZE_SHARE = { small: 0.045, medium: 0.06, large: 0.08, xlarge: 0.105 };
const PREVIEW_HEIGHT = 160;

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <span id={id} className="block text-xs font-medium">
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={id} className="flex flex-wrap gap-1">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 rounded-md border px-2.5 text-xs disabled:opacity-50",
              value === option.value
                ? "border-primary bg-primary-soft text-primary"
                : "border-input text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (color: string) => void;
}) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0 space-y-1.5 disabled:opacity-50">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5"
        />
        {SWATCHES.map((color) => (
          <button
            key={color}
            type="button"
            aria-label={color}
            aria-pressed={value.toUpperCase() === color}
            onClick={() => onChange(color)}
            style={{ backgroundColor: color }}
            className={cn(
              "size-6 rounded-full border",
              value.toUpperCase() === color
                ? "border-primary ring-2 ring-primary"
                : "border-input",
            )}
          />
        ))}
      </div>
    </fieldset>
  );
}

// How the captions look when drawn into the video, with a sample.
function CaptionStyleFields({
  style,
  sample,
  onChange,
}: {
  style: CaptionStyle;
  // A caption of the film to show the style on.
  sample: string;
  onChange: (patch: Partial<CaptionStyle>) => void;
}) {
  const { t } = useTranslation();
  const outline = style.outline;

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <p className="text-xs font-semibold">
        {t("projects.timeline.captions.style.title")}
      </p>
      <div
        aria-hidden="true"
        style={{ height: PREVIEW_HEIGHT }}
        className={cn(
          "mx-auto flex aspect-video max-w-full justify-center overflow-hidden rounded-md bg-[linear-gradient(135deg,#1f2937,#0b1220_55%,#3b2f1a)] px-3 py-2 text-center",
          style.position === "top"
            ? "items-start"
            : style.position === "middle"
              ? "items-center"
              : "items-end",
        )}
      >
        <span
          style={{
            color: style.color,
            fontSize: Math.round(PREVIEW_HEIGHT * SIZE_SHARE[style.size]),
            fontWeight: style.bold ? 700 : 400,
            fontFamily: "Arial, sans-serif",
            lineHeight: 1.25,
            // An outline all the way round, as the video draws it.
            textShadow: style.box
              ? undefined
              : `1px 0 0 ${outline}, -1px 0 0 ${outline}, 0 1px 0 ${outline}, 0 -1px 0 ${outline}, 1px 1px 0 ${outline}, -1px -1px 0 ${outline}, 1px -1px 0 ${outline}, -1px 1px 0 ${outline}`,
            backgroundColor: style.box ? "rgba(0, 0, 0, 0.56)" : undefined,
            padding: style.box ? "0.1em 0.4em" : undefined,
          }}
        >
          {sample || t("projects.timeline.captions.style.sample")}
        </span>
      </div>
      <div className="space-y-3">
        <Choice
          label={t("projects.timeline.captions.style.font")}
          options={CAPTION_FONTS.map((value) => ({ value, label: value }))}
          value={style.font}
          onChange={(font) => onChange({ font })}
        />
        <Choice
          label={t("projects.timeline.captions.style.size")}
          options={CAPTION_SIZES.map((value) => ({
            value,
            label: t(`projects.timeline.captions.style.sizes.${value}`),
          }))}
          value={style.size}
          onChange={(size) => onChange({ size })}
        />
        <Choice
          label={t("projects.timeline.captions.style.position")}
          options={CAPTION_POSITIONS.map((value) => ({
            value,
            label: t(`projects.timeline.captions.style.positions.${value}`),
          }))}
          value={style.position}
          onChange={(position) => onChange({ position })}
        />
        <ColorField
          label={t("projects.timeline.captions.style.color")}
          value={style.color}
          onChange={(color) => onChange({ color })}
        />
        <ColorField
          label={t("projects.timeline.captions.style.outline")}
          value={style.outline}
          // A box replaces the outline.
          disabled={style.box}
          onChange={(color) => onChange({ outline: color })}
        />
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-[13px]">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={style.bold}
            onChange={(event) => onChange({ bold: event.target.checked })}
            className="size-4 accent-primary"
          />
          {t("projects.timeline.captions.style.bold")}
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={style.box}
            onChange={(event) => onChange({ box: event.target.checked })}
            className="size-4 accent-primary"
          />
          {t("projects.timeline.captions.style.box")}
        </label>
      </div>
    </div>
  );
}

// A length of time picked on a slider, shown in seconds beside its label.
function SecondsRange({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (seconds: number) => void;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center justify-between text-xs">
        {label}
        <span className="font-mono text-muted-foreground">
          {secondsLabel(value)}
        </span>
      </Label>
      <input
        id={id}
        type="range"
        min={0}
        max={max}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
    </div>
  );
}

// Whether added audio steps back while the clips' own sound is heard.
export function DuckField({
  duck,
  editable,
  onChange,
}: {
  duck: boolean;
  editable: boolean;
  onChange: (duck: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input
        type="checkbox"
        checked={duck}
        disabled={!editable}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-primary"
      />
      <span>
        {t("projects.timeline.audio.duck")}
        <span className="block text-xs leading-5 text-faint">
          {t("projects.timeline.audio.duckHint")}
        </span>
      </span>
    </label>
  );
}
