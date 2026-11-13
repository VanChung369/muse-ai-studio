import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { formatRelativeTime } from "@/lib/format";
import { ProjectCover } from "./project-cover";
import { ProjectProgress } from "./project-progress";
import { ProjectStatusBadge } from "./project-status-badge";
import type { ProjectSummary } from "../types";

export function ProjectCard({
  project,
  onOpen,
}: {
  project: ProjectSummary;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();
  const updated = formatRelativeTime(project.updatedAt, language, now);

  return (
    <button
      type="button"
      data-project-id={project.id}
      aria-label={t("projects.openProject", { name: project.name })}
      onClick={() => onOpen(project.id)}
      className="flex min-w-0 cursor-pointer flex-col gap-3 rounded-xl border bg-card p-2.5 pb-3.5 text-left transition-colors hover:border-input hover:bg-secondary motion-reduce:transition-none"
    >
      <ProjectCover project={project} />
      <div className="flex w-full flex-1 flex-col gap-2 px-1">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 text-sm leading-5.5 font-semibold wrap-break-word">
            {project.name}
          </h3>
          <ProjectStatusBadge status={project.status} />
        </div>
        <p className="text-xs leading-5 text-faint">
          {project.aspectRatio} ·{" "}
          {t("projects.sceneCount", { count: project.sceneCount })} · {updated}
        </p>
        {project.status === "rendering" && (
          <ProjectProgress project={project} />
        )}
        {project.status === "failed" && (
          <p className="mt-1 flex items-start gap-1.5 text-xs leading-5 text-destructive">
            <CircleAlert className="mt-1 size-3 shrink-0" aria-hidden="true" />
            {t("projects.error", {
              scene: project.currentScene ?? 1,
              reason: t(`projects.errors.${project.errorCode ?? "unknown"}`),
            })}
          </p>
        )}
        {project.status === "cancelled" && (
          <p className="mt-1 text-xs leading-5 text-faint">
            {t("projects.cancelledAt", {
              scene: project.currentScene ?? 1,
              count: project.sceneCount,
            })}
          </p>
        )}
      </div>
    </button>
  );
}
