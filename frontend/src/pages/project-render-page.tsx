import { ArrowRight, Clapperboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router";

import { Button } from "@/components/ui/button";
import { RenderBoard } from "@/features/projects/components/render-board";
import { projectStepHref } from "@/features/projects/lib/project-list";
import type { Project } from "@/features/projects/types";

// Step 3 of a project, "Render" (design board 13): start, follow, cancel and
// continue the render, scene by scene.
export function ProjectRenderPage() {
  const { t } = useTranslation();
  const project = useOutletContext<Project>();

  if (project.sceneCount === 0)
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
        <Clapperboard className="size-8 text-faint" aria-hidden="true" />
        <p className="text-sm leading-6 text-muted-foreground">
          {t("projects.workspace.render.needScript")}
        </p>
        <Button variant="outline" asChild>
          <Link to={projectStepHref(project.id, "script")}>
            {t("projects.output.steps.script")}
          </Link>
        </Button>
      </div>
    );

  return (
    <>
      {project.status === "completed" && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-success-soft px-4 py-3 tablet:px-6">
          <p className="text-sm text-success">
            {t("projects.render.headline.completed")}
          </p>
          <Button asChild>
            <Link to={projectStepHref(project.id, "output")}>
              {t("projects.workspace.render.toOutput")}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      )}
      <RenderBoard key={project.id} project={project} />
    </>
  );
}
