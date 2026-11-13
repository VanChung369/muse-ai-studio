import { ArrowRight, Clapperboard } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { ProjectStatusBadge } from "./project-status-badge";
import type { FeaturedProject as FeaturedProjectData } from "../types";

export function FeaturedProject({
  project,
  onOpen,
}: {
  project: FeaturedProjectData;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();

  return (
    <section
      aria-labelledby="featured-project-title"
      className="grid grid-cols-[repeat(auto-fit,minmax(min(380px,100%),1fr))] overflow-hidden rounded-xl border border-primary-line bg-card"
    >
      <div
        aria-hidden="true"
        className="grid grid-cols-3 gap-2 border-b p-4 desktop:border-r desktop:border-b-0"
      >
        {project.previewScenes.length > 0 ? (
          project.previewScenes.map((scene) => (
            <div
              key={scene.number}
              className="flex aspect-video min-w-0 flex-col justify-end gap-1 rounded-lg border border-input bg-secondary p-2"
            >
              <span className="font-mono text-[10px] text-faint">
                {String(scene.number).padStart(2, "0")}
              </span>
              <span className="truncate text-[11px] text-foreground">
                {scene.title}
              </span>
            </div>
          ))
        ) : (
          <div className="col-span-3 flex min-h-40 items-center justify-center text-input">
            <Clapperboard className="size-10" />
          </div>
        )}
      </div>
      <div className="flex flex-col justify-center gap-3 px-6 py-5.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="text-[10px] font-semibold tracking-widest text-faint uppercase">
            {t("projects.featured.eyebrow")}
          </span>
          <ProjectStatusBadge status={project.status} />
        </div>
        <h2
          id="featured-project-title"
          className="text-lg leading-7 font-semibold"
        >
          {project.name}
        </h2>
        <p className="text-xs leading-5 text-faint">
          {project.aspectRatio} ·{" "}
          {t("projects.sceneCount", { count: project.sceneCount })} ·{" "}
          {formatDuration(project.durationSeconds)} ·{" "}
          {t("projects.updated", {
            time: formatRelativeTime(project.updatedAt, language, now),
          })}
        </p>
        {project.status === "ready" && (
          <p className="text-[13px] leading-5.5">
            {t("projects.featured.hint")}
          </p>
        )}
        <ActionBar className="mt-1">
          <Button onClick={() => onOpen(project.id)}>
            {t(
              project.status === "ready"
                ? "projects.featured.review"
                : "projects.featured.view",
            )}
            <ArrowRight aria-hidden="true" />
          </Button>
        </ActionBar>
      </div>
    </section>
  );
}
