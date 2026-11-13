import { CircleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { formatRelativeTime } from "@/lib/format";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { ProjectCover } from "./project-cover";
import { ProjectProgress } from "./project-progress";
import { ProjectStatusBadge } from "./project-status-badge";
import type { ProjectSummary } from "../types";

export function ProjectCard({
  project,
  onOpen,
  onDeleted,
}: {
  project: ProjectSummary;
  onOpen: (id: string) => void;
  onDeleted: (id: string, name: string) => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();
  const updated = formatRelativeTime(project.updatedAt, language, now);

  return (
    <article className="relative flex min-w-0 rounded-xl border bg-card transition-colors hover:border-input hover:bg-secondary motion-reduce:transition-none">
      <button
        type="button"
        data-project-id={project.id}
        aria-label={t("projects.openProject", { name: project.name })}
        onClick={() => onOpen(project.id)}
        className="flex w-full min-w-0 flex-1 cursor-pointer flex-col gap-3 rounded-xl p-2.5 pb-3.5 text-left"
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
      <DeleteProjectDialog project={project} compact onDeleted={onDeleted} />
    </article>
  );
}
