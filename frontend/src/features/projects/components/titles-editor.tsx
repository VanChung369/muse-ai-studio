import { Plus, Trash2, Type } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  CAPTION_SIZES,
  TITLE_POSITIONS,
  type TimelineTitle,
} from "../api/timeline";
import { toTenth } from "../lib/project-timeline";
import { SecondsInput } from "./studio-timeline";

const MAX_TITLES = 50;
const TITLE_LENGTH = 300;

// Matches the caption row layout: number, start, end, text, delete.
const ROW =
  "grid grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 tablet:grid-cols-[1.5rem_5rem_5rem_minmax(0,1fr)_auto]";

// Matches the caption editor swatches next to the free colour picker.
const SWATCHES = [
  "#FFFFFF",
  "#FFE000",
  "#00E5FF",
  "#7CFF6B",
  "#FF5A5A",
  "#000000",
];

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
      <div
        role="radiogroup"
        aria-labelledby={id}
        className="flex flex-wrap gap-1"
      >
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
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  const id = useId();
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          className="h-7 w-9 cursor-pointer rounded border border-input bg-transparent p-0.5 disabled:opacity-50"
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
              "size-6 rounded-full border disabled:opacity-50",
              value.toUpperCase() === color
                ? "border-primary ring-2 ring-primary"
                : "border-input",
            )}
          />
        ))}
      </div>
    </div>
  );
}

export function TitlesEditor({
  titles,
  at,
  selected,
  onChange,
  onSelect,
}: {
  titles: TimelineTitle[];
  // Where a new title starts: where the film is playing.
  at: number;
  // Index of the selected title, or null.
  selected: number | null;
  onChange: (titles: TimelineTitle[]) => void;
  onSelect: (index: number | null) => void;
}) {
  const { t } = useTranslation();
  const styleId = useId();

  function patch(index: number, change: Partial<TimelineTitle>) {
    onChange(
      titles.map((title, position) =>
        position === index ? { ...title, ...change } : title,
      ),
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={titles.length >= MAX_TITLES}
          onClick={() => {
            const start = toTenth(at);
            onChange([
              ...titles,
              {
                start,
                end: toTenth(start + 3),
                text: "",
                size: "large",
                color: "#FFFFFF",
                position: "center",
                bold: true,
                box: false,
              },
            ]);
            onSelect(titles.length);
          }}
        >
          <Plus aria-hidden="true" />
          {t("projects.timeline.titles.add")}
        </Button>
        {titles.length > 0 && (
          <span className="ml-auto text-xs text-faint">
            {t("projects.timeline.titles.count", { count: titles.length })}
          </span>
        )}
      </div>

      {titles.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-input px-6 py-10 text-center">
          <Type className="size-6 text-faint" aria-hidden="true" />
          <p className="max-w-sm text-[13px] leading-6 text-muted-foreground">
            {t("projects.timeline.titles.empty")}
          </p>
        </div>
      ) : (
        <div className="min-w-0 overflow-hidden rounded-lg border">
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
            {titles.map((title, index) => (
              <li
                key={index}
                onFocusCapture={() => onSelect(index)}
                className={cn(
                  "px-2.5 py-2",
                  selected === index
                    ? "bg-primary-soft shadow-[inset_2px_0_0_var(--color-primary)]"
                    : "hover:bg-background",
                )}
              >
                <div className={cn(ROW, "items-start")}>
                  <span className="grid h-8 place-items-center font-mono text-[11px] text-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <SecondsInput
                    aria-label={t("projects.timeline.captions.start")}
                    value={title.start}
                    fit={(seconds) =>
                      Math.min(
                        Math.max(toTenth(seconds), 0),
                        toTenth(title.end - 0.2),
                      )
                    }
                    onCommit={(start) => patch(index, { start })}
                    className="h-8 px-2 text-xs"
                  />
                  <SecondsInput
                    aria-label={t("projects.timeline.captions.end")}
                    value={title.end}
                    fit={(seconds) =>
                      Math.min(
                        Math.max(toTenth(seconds), toTenth(title.start + 0.2)),
                        3600,
                      )
                    }
                    onCommit={(end) => patch(index, { end })}
                    className="h-8 px-2 text-xs"
                  />
                  <Textarea
                    aria-label={t("projects.timeline.captions.text")}
                    value={title.text}
                    rows={1}
                    spellCheck={false}
                    maxLength={TITLE_LENGTH}
                    placeholder={t("projects.timeline.titles.placeholder")}
                    onChange={(event) =>
                      patch(index, { text: event.target.value })
                    }
                    className="min-h-8 resize-none px-2.5 py-1.5 text-[13px] leading-5 max-tablet:col-span-full max-tablet:row-start-2 md:text-[13px]"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                    aria-label={t("projects.timeline.titles.remove")}
                    onClick={() => {
                      onChange(
                        titles.filter((_, position) => position !== index),
                      );
                      onSelect(null);
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>

                {selected === index && (
                  <div
                    role="group"
                    aria-labelledby={styleId}
                    className="mt-2.5 flex flex-wrap items-start gap-4 border-t border-border/60 pt-2.5"
                  >
                    <span id={styleId} className="sr-only">
                      {t("projects.timeline.titles.style")}
                    </span>

                    <div className="space-y-1.5">
                      <span className="block text-xs font-medium">
                        {t("projects.timeline.titles.position")}
                      </span>
                      <div
                        role="radiogroup"
                        aria-label={t("projects.timeline.titles.position")}
                        className="grid w-fit grid-cols-3 gap-1"
                      >
                        {TITLE_POSITIONS.map((position) => {
                          const active = title.position === position;
                          return (
                            <button
                              key={position}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              aria-label={t(
                                `projects.timeline.titles.positions.${position}`,
                              )}
                              title={t(
                                `projects.timeline.titles.positions.${position}`,
                              )}
                              onClick={() => patch(index, { position })}
                              className={cn(
                                "grid size-6 place-items-center rounded border transition-colors disabled:opacity-50",
                                active
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-input bg-background text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <span
                                aria-hidden="true"
                                className="size-1.5 rounded-full bg-current"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <Choice
                      label={t("projects.timeline.captions.style.size")}
                      options={CAPTION_SIZES.map((size) => ({
                        value: size,
                        label: t(`projects.timeline.captions.style.sizes.${size}`),
                      }))}
                      value={title.size}
                      onChange={(size) => patch(index, { size })}
                    />

                    <ColorField
                      label={t("projects.timeline.captions.style.color")}
                      value={title.color}
                      onChange={(color) => patch(index, { color })}
                    />

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 self-end pb-1 text-[13px]">
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={title.bold}
                          onChange={(event) =>
                            patch(index, { bold: event.target.checked })
                          }
                          className="size-4 accent-primary disabled:opacity-50"
                        />
                        {t("projects.timeline.captions.style.bold")}
                      </label>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={title.box}
                          onChange={(event) =>
                            patch(index, { box: event.target.checked })
                          }
                          className="size-4 accent-primary disabled:opacity-50"
                        />
                        {t("projects.timeline.captions.style.box")}
                      </label>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
