import { Trash2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { ProjectMedia } from "../api/media";
import { LOGO_CORNERS, type TimelineLogo } from "../api/timeline";

type Corner = (typeof LOGO_CORNERS)[number];

const CORNER_ALIGN: Record<Corner, string> = {
  "top-left": "items-start justify-start",
  "top-right": "items-start justify-end",
  "bottom-left": "items-end justify-start",
  "bottom-right": "items-end justify-end",
};

export function LogoFields({
  logo,
  images,
  onChange,
}: {
  logo: TimelineLogo | null;
  // The project's uploaded pictures (already filtered to kind "image").
  images: ProjectMedia[];
  onChange: (logo: TimelineLogo | null) => void;
}) {
  const { t } = useTranslation();
  const id = useId();

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-semibold">
          {t("projects.timeline.logo.title")}
        </p>
        <p className="text-xs text-faint">{t("projects.timeline.logo.hint")}</p>
      </div>

      {images.length === 0 ? (
        <p className="text-xs text-faint">
          {t("projects.timeline.logo.noImages")}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {images.map((image) => {
            const chosen = logo?.mediaId === image.id;
            return (
              <button
                key={image.id}
                type="button"
                aria-label={t("projects.timeline.logo.choose", {
                  name: image.name,
                })}
                aria-pressed={chosen}
                onClick={() =>
                  onChange({
                    mediaId: image.id,
                    corner: logo?.corner ?? "top-right",
                    size: logo?.size ?? 14,
                    opacity: logo?.opacity ?? 1,
                    url: image.url,
                  })
                }
                className={cn(
                  "size-14 overflow-hidden rounded-md border bg-secondary transition-colors disabled:opacity-50",
                  chosen
                    ? "border-primary ring-2 ring-primary"
                    : "border-input hover:border-input-hover",
                )}
              >
                <img
                  src={image.thumbnailUrl ?? image.url}
                  alt=""
                  draggable={false}
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      )}

      {logo && (
        <div className="space-y-3 pt-1">
          <div className="space-y-1.5">
            <span id={`${id}-corner`} className="block text-xs font-medium">
              {t("projects.timeline.logo.corner")}
            </span>
            <div
              role="radiogroup"
              aria-labelledby={`${id}-corner`}
              className="grid w-fit grid-cols-2 gap-1"
            >
              {LOGO_CORNERS.map((corner) => {
                const active = logo.corner === corner;
                return (
                  <button
                    key={corner}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={t(`projects.timeline.logo.corners.${corner}`)}
                    title={t(`projects.timeline.logo.corners.${corner}`)}
                    onClick={() => onChange({ ...logo, corner })}
                    className={cn(
                      "flex size-7 rounded border p-1 transition-colors disabled:opacity-50",
                      CORNER_ALIGN[corner],
                      active
                        ? "border-primary bg-primary-soft text-primary"
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

          <div className="space-y-1.5">
            <Label
              htmlFor={`${id}-size`}
              className="flex items-center justify-between text-xs"
            >
              {t("projects.timeline.logo.size")}
              <span className="font-mono text-muted-foreground">
                {logo.size}%
              </span>
            </Label>
            <input
              id={`${id}-size`}
              type="range"
              min={5}
              max={40}
              step={1}
              value={logo.size}
              onChange={(event) =>
                onChange({ ...logo, size: Number(event.target.value) })
              }
              className="w-full accent-primary disabled:opacity-50"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor={`${id}-opacity`}
              className="flex items-center justify-between text-xs"
            >
              {t("projects.timeline.logo.opacity")}
              <span className="font-mono text-muted-foreground">
                {Math.round(logo.opacity * 100)}%
              </span>
            </Label>
            <input
              id={`${id}-opacity`}
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={logo.opacity}
              onChange={(event) =>
                onChange({ ...logo, opacity: Number(event.target.value) })
              }
              className="w-full accent-primary disabled:opacity-50"
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange(null)}
          >
            <Trash2 aria-hidden="true" />
            {t("projects.timeline.logo.remove")}
          </Button>
        </div>
      )}
    </div>
  );
}
