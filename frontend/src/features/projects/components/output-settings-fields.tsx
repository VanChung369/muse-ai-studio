import { useId } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import {
  OUTPUT_ASPECTS,
  OUTPUT_FITS,
  OUTPUT_HEIGHTS,
  OUTPUT_QUALITIES,
  type TimelineOutput,
} from "../api/timeline";

function Choice<T extends string | number>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  disabled?: boolean;
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
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            disabled={disabled}
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

// Translation keys cannot hold a colon, so each shape has a plain name.
const ASPECT_NAMES = { "16:9": "wide", "9:16": "tall", "1:1": "square" } as const;

export function OutputSettingsFields({
  value,
  sourceAspect,
  onChange,
}: {
  value: TimelineOutput;
  // The shape of the project's scenes, e.g. "16:9".
  sourceAspect: string;
  onChange: (patch: Partial<TimelineOutput>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold">
          {t("projects.timeline.outputSettings.title")}
        </p>
        <p className="text-xs text-faint">
          {t("projects.timeline.outputSettings.hint")}
        </p>
      </div>

      <div className="space-y-3">
        <Choice
          label={t("projects.timeline.outputSettings.aspect")}
          options={OUTPUT_ASPECTS.map((aspect) => ({
            value: aspect,
            label:
              aspect === "source"
                ? t("projects.timeline.outputSettings.aspects.source", {
                    ratio: sourceAspect,
                  })
                : t(
                    `projects.timeline.outputSettings.aspects.${ASPECT_NAMES[aspect]}`,
                  ),
          }))}
          value={value.aspect}
          onChange={(aspect) => onChange({ aspect })}
        />

        <Choice
          label={t("projects.timeline.outputSettings.fit")}
          options={OUTPUT_FITS.map((fit) => ({
            value: fit,
            label: t(`projects.timeline.outputSettings.fits.${fit}`),
          }))}
          value={value.fit}
          disabled={value.aspect === "source"}
          onChange={(fit) => onChange({ fit })}
        />

        <Choice
          label={t("projects.timeline.outputSettings.height")}
          options={OUTPUT_HEIGHTS.map((height) => ({
            value: height,
            label:
              height === 0
                ? t("projects.timeline.outputSettings.heights.source")
                : t(`projects.timeline.outputSettings.heights.p${height}`),
          }))}
          value={value.height}
          onChange={(height) => onChange({ height })}
        />

        <div className="space-y-1.5">
          <Choice
            label={t("projects.timeline.outputSettings.quality")}
            options={OUTPUT_QUALITIES.map((quality) => ({
              value: quality,
              label: t(`projects.timeline.outputSettings.qualities.${quality}`),
            }))}
            value={value.quality}
            onChange={(quality) => onChange({ quality })}
          />
          <p className="text-xs text-faint">
            {t("projects.timeline.outputSettings.qualityHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
