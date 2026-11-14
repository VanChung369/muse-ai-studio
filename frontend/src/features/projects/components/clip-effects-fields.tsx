import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { CLIP_EFFECTS, CLIP_ZOOMS } from "../api/timeline";
import { EFFECT_CSS, MAX_CLIP_FADE } from "../lib/clip-effects";
import type { TimelineItem } from "../types";

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

function FadeField({
  id,
  label,
  value,
  valueLabel,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  valueLabel: string;
  onChange: (seconds: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-center justify-between text-xs">
        {label}
        <span className="font-mono text-muted-foreground">{valueLabel}</span>
      </Label>
      <input
        id={id}
        type="range"
        min={0}
        max={MAX_CLIP_FADE}
        step={0.1}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-primary disabled:opacity-50"
      />
    </div>
  );
}

export function ClipEffectsFields({
  item,
  onChange,
}: {
  item: TimelineItem;
  onChange: (patch: Partial<TimelineItem>) => void;
}) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <div className="space-y-4">
      <p className="text-sm font-semibold">
        {t("projects.timeline.effects.title")}
      </p>

      <div className="space-y-1.5">
        <span id={`${id}-look`} className="block text-xs font-medium">
          {t("projects.timeline.effects.look")}
        </span>
        <div
          role="radiogroup"
          aria-labelledby={`${id}-look`}
          className="grid grid-cols-3 gap-1.5"
        >
          {CLIP_EFFECTS.map((effect) => {
            const selected = item.effect === effect;
            return (
              <button
                key={effect}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ effect })}
                className={cn(
                  "flex flex-col overflow-hidden rounded-md border text-left transition-colors disabled:opacity-50",
                  selected
                    ? "border-primary ring-1 ring-primary"
                    : "border-input hover:border-input-hover",
                )}
              >
                <span className="relative block aspect-video w-full overflow-hidden bg-secondary">
                  {item.thumbnailUrl && (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      draggable={false}
                      style={{ filter: EFFECT_CSS[effect] }}
                      className="h-full w-full object-cover"
                    />
                  )}
                  {effect === "vignette" && (
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_45%,rgba(0,0,0,0.75)_100%)]"
                    />
                  )}
                </span>
                <span
                  className={cn(
                    "block w-full truncate px-1.5 py-1 text-[11px] leading-tight",
                    selected
                      ? "font-medium text-primary"
                      : "text-muted-foreground",
                  )}
                >
                  {t(`projects.timeline.effects.names.${effect}`)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <Choice
        label={t("projects.timeline.effects.zoom")}
        options={CLIP_ZOOMS.map((zoom) => ({
          value: zoom,
          label: t(`projects.timeline.effects.zooms.${zoom}`),
        }))}
        value={item.zoom}
        onChange={(zoom) => onChange({ zoom })}
      />

      <label className="flex cursor-pointer items-center gap-2 text-[13px]">
        <input
          type="checkbox"
          checked={item.flip}
          onChange={(event) => onChange({ flip: event.target.checked })}
          className="size-4 shrink-0 accent-primary disabled:opacity-50"
        />
        {t("projects.timeline.effects.flip")}
      </label>

      <div className="space-y-3">
        <FadeField
          id={`${id}-fade-in`}
          label={t("projects.timeline.effects.fadeIn")}
          value={item.fadeIn}
          valueLabel={t("projects.timeline.effects.seconds", {
            seconds: item.fadeIn.toFixed(1),
          })}
          onChange={(fadeIn) => onChange({ fadeIn })}
        />
        <FadeField
          id={`${id}-fade-out`}
          label={t("projects.timeline.effects.fadeOut")}
          value={item.fadeOut}
          valueLabel={t("projects.timeline.effects.seconds", {
            seconds: item.fadeOut.toFixed(1),
          })}
          onChange={(fadeOut) => onChange({ fadeOut })}
        />
      </div>
    </div>
  );
}
