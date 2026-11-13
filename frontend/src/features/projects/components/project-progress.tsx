import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { ProjectSummary } from "../types";

export function ProjectProgress({ project }: { project: ProjectSummary }) {
  const { t } = useTranslation();

  return (
    <div className="mt-1 flex items-center gap-2.5">
      <div
        role="progressbar"
        aria-label={t("projects.renderProgress", {
          completed: project.completedScenes,
          count: project.sceneCount,
        })}
        aria-valuemin={0}
        aria-valuemax={project.sceneCount}
        aria-valuenow={project.completedScenes}
        className="flex h-1.5 min-w-0 flex-1 gap-0.5"
      >
        {Array.from({ length: project.sceneCount }, (_, index) => (
          <span
            key={index}
            className={cn(
              "flex-1 rounded-xs bg-accent",
              index < project.completedScenes && "bg-success",
              index === project.completedScenes &&
                "bg-running motion-safe:animate-pulse",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-[11px] text-muted-foreground">
        {project.completedScenes}/{project.sceneCount}
      </span>
    </div>
  );
}
