import { ArrowLeft, ArrowRight } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { clampCut } from "../lib/project-timeline";
import type { TimelineItem } from "../types";

const secondsLabel = (value: number) => `${value.toFixed(1)}s`;

type Edge = "start" | "end";
type Trim = {
  scene: number;
  edge: Edge;
  // Pointer position and the cut when the drag began, and the track's width.
  x: number;
  start: number;
  end: number;
  width: number;
};

// The film's video track, edited directly as in a video editor: drag a clip
// to move it, drag either edge to trim it. `span` is the number of seconds the
// full track width stands for, so the track lines up with the ruler above it
// and keeps its scale while a clip is trimmed.
export function TimelineStrip({
  items,
  span,
  selected,
  editable,
  onSelect,
  onMove,
  onTrim,
}: {
  items: TimelineItem[];
  span: number;
  selected: number | null;
  editable: boolean;
  onSelect: (scene: number) => void;
  onMove: (from: number, to: number) => void;
  onTrim: (scene: number, edge: Edge, seconds: number) => void;
}) {
  const track = useRef<HTMLOListElement>(null);
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
    onSelect(item.scene);
    setTrim({
      scene: item.scene,
      edge,
      x: event.clientX,
      start: item.start,
      end: item.end,
      width: track.current.getBoundingClientRect().width,
    });
  }

  function moveTrim(event: React.PointerEvent, item: TimelineItem) {
    if (!trim || trim.scene !== item.scene || trim.width <= 0) return;
    const delta = ((event.clientX - trim.x) / trim.width) * span;
    const seconds = clampCut(item, trim.edge, trim[trim.edge] + delta);
    if (seconds !== item[trim.edge]) onTrim(item.scene, trim.edge, seconds);
  }

  function endTrim() {
    trimming.current = false;
    setTrim(null);
  }

  return (
    <ol ref={track} className="flex">
      {items.map((item, index) => {
        const trimmed = trim?.scene === item.scene ? trim : null;
        return (
          <li
            key={item.scene}
            style={{
              width: `${((item.end - item.start) / span) * 100}%`,
              // While the head is dragged the clip's left edge follows the
              // pointer; the gap closes when the drag ends.
              marginLeft:
                trimmed?.edge === "start"
                  ? `${((item.start - trimmed.start) / span) * 100}%`
                  : undefined,
            }}
            className="min-w-0 shrink-0 px-px"
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
            <div
              className={cn(
                "group relative h-16 overflow-hidden rounded-md border",
                selected === item.scene ? "border-primary" : "border-input",
                dragged === index && "opacity-40",
                target === index && dragged !== index && "ring-2 ring-primary",
              )}
            >
              <button
                type="button"
                draggable={editable}
                aria-pressed={selected === item.scene}
                onClick={() => onSelect(item.scene)}
                onDragStart={(event) => {
                  if (trimming.current) event.preventDefault();
                  else setDragged(index);
                }}
                onDragEnd={() => {
                  setDragged(null);
                  setTarget(null);
                }}
                className={cn(
                  "absolute inset-0 text-left",
                  editable && "cursor-grab active:cursor-grabbing",
                )}
              >
                <img
                  src={item.thumbnailUrl}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  className="absolute inset-0 h-full w-full object-cover"
                />
                <span className="absolute inset-0 bg-linear-to-t from-black/85 via-black/25 to-black/40" />
                <span className="absolute top-1 left-3 grid min-w-4 place-items-center rounded bg-black/70 px-1 font-mono text-[10px] leading-4 text-white">
                  {item.scene}
                </span>
                <span className="absolute inset-x-3 bottom-1 flex items-end justify-between gap-2 text-white">
                  <span className="min-w-0 truncate text-[11px] font-medium">
                    {item.title}
                  </span>
                  <span className="shrink-0 font-mono text-[10px]">
                    {secondsLabel(item.end - item.start)}
                  </span>
                </span>
              </button>
              {editable &&
                (["start", "end"] as const).map((edge) => (
                  // Trim handles are pointer-only; the cut editor offers the
                  // same change with exact numbers and the keyboard.
                  <span
                    key={edge}
                    aria-hidden="true"
                    onPointerDown={(event) => beginTrim(event, item, edge)}
                    onPointerMove={(event) => moveTrim(event, item)}
                    onPointerUp={endTrim}
                    onPointerCancel={endTrim}
                    // The capture can end without a pointerup (a context menu,
                    // the window losing focus): never stay in a trim.
                    onLostPointerCapture={endTrim}
                    className={cn(
                      "absolute inset-y-0 z-10 flex w-2.5 cursor-ew-resize touch-none items-center justify-center bg-black/40",
                      edge === "start" ? "left-0" : "right-0",
                      trimmed?.edge === edge
                        ? "bg-primary"
                        : "opacity-0 group-hover:opacity-100",
                      selected === item.scene && "opacity-100",
                    )}
                  >
                    <span className="h-6 w-0.5 rounded-full bg-white/80" />
                  </span>
                ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// One edge of the cut as a number. While it is typed the text is kept as it
// is ("1" on the way to "10"); the cut follows as soon as the number fits, and
// leaving the field or Enter settles it on the nearest value that does.
function CutInput({
  id,
  item,
  edge,
  onCommit,
}: {
  id: string;
  item: TimelineItem;
  edge: Edge;
  onCommit: (seconds: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function settle() {
    const value = Number.parseFloat(draft ?? "");
    if (!Number.isNaN(value)) onCommit(clampCut(item, edge, value));
    setDraft(null);
  }

  return (
    <Input
      id={id}
      type="number"
      min={0}
      max={item.clipSeconds}
      step={0.1}
      value={draft ?? item[edge]}
      onChange={(event) => {
        const raw = event.target.value;
        const value = Number.parseFloat(raw);
        const fits =
          !Number.isNaN(value) && clampCut(item, edge, value) === value;
        if (fits) onCommit(value);
        // Text that already is the cut needs no draft: the field shows it.
        setDraft(fits && String(value) === raw ? null : raw);
      }}
      onBlur={settle}
      onKeyDown={(event) => {
        if (event.key === "Enter") settle();
      }}
      className="h-9 font-mono"
    />
  );
}

// Trim, position and inclusion of the selected scene, with exact numbers.
export function TimelineCutEditor({
  item,
  index,
  count,
  editable,
  onChange,
  onMove,
}: {
  item: TimelineItem;
  index: number;
  count: number;
  editable: boolean;
  onChange: (patch: Partial<TimelineItem>) => void;
  onMove: (from: number, to: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <fieldset disabled={!editable} className="space-y-3">
      <legend className="text-sm font-semibold">
        {t("projects.timeline.cut")}
      </legend>
      <div className="grid grid-cols-2 gap-3">
        {(["start", "end"] as const).map((edge) => (
          <div key={edge} className="space-y-1.5">
            <Label htmlFor={`${id}-${edge}`} className="text-xs">
              {t(`projects.timeline.${edge}`)}
            </Label>
            <CutInput
              id={`${id}-${edge}`}
              item={item}
              edge={edge}
              onCommit={(seconds) => onChange({ [edge]: seconds })}
            />
          </div>
        ))}
      </div>
      <p className="text-xs text-faint">
        {t("projects.timeline.clipLength", {
          seconds: item.clipSeconds.toFixed(1),
        })}
      </p>
      <label className="flex items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={item.enabled}
          onChange={(event) => onChange({ enabled: event.target.checked })}
          className="size-4 accent-primary"
        />
        {t("projects.timeline.include")}
      </label>
      <div className="flex flex-wrap gap-2">
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
      </div>
    </fieldset>
  );
}
