import { ArrowLeft, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, NavLink, Outlet, useParams } from "react-router";

import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { ProjectStatusBadge } from "@/features/projects/components/project-status-badge";
import { useProjectQuery } from "@/features/projects/hooks/use-project-queries";
import {
  PROJECT_STEPS,
  projectStepHref,
  resumeStep,
} from "@/features/projects/lib/project-list";
import type { Project } from "@/features/projects/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

function isStepDone(project: Project, step: (typeof PROJECT_STEPS)[number]) {
  if (step === "idea") return true;
  if (step === "script") return project.sceneCount > 0;
  if (step === "render")
    return (
      project.sceneCount > 0 && project.completedScenes === project.sceneCount
    );
  return project.status === "completed";
}

// A project opened as a workspace (design boards 11–14): one header with the
// four steps, and the current step's page underneath. Each step is a page of
// its own; nothing here opens the details sheet.
export function ProjectWorkspaceLayout() {
  const { t } = useTranslation();
  const { projectId = "" } = useParams();
  const project = useProjectQuery(projectId);
  useDocumentTitle(project.data?.name ?? t("pages.projects.title"));

  if (project.isPending) return <PageLoading />;
  if (!project.data)
    return (
      <div role="alert" className="space-y-3 p-8">
        <p className="text-sm text-muted-foreground">
          {t("projects.details.loadError")}
        </p>
        <Button variant="outline" asChild>
          <Link to={ROUTES.PROJECTS}>{t("projects.output.back")}</Link>
        </Button>
      </div>
    );
  const data = project.data;

  return (
    <div className="flex w-full flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b px-4 py-3 tablet:px-6">
        <Button variant="ghost" size="icon" asChild>
          <Link to={ROUTES.PROJECTS} aria-label={t("projects.output.back")}>
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0">
          <h1 className="truncate text-base leading-5 font-semibold">
            {data.name}
          </h1>
          <p className="truncate font-mono text-[11px] leading-4 text-faint">
            {data.aspectRatio}
            {data.sceneCount > 0 &&
              ` · ${t("projects.sceneCount", { count: data.sceneCount })}`}
            {` · ${formatDuration(data.durationSeconds)}`}
          </p>
        </div>
        <nav
          aria-label={t("projects.output.stepsLabel")}
          className="mx-auto flex flex-wrap items-center gap-2 text-[13px]"
        >
          {PROJECT_STEPS.map((step, index) => (
            <span key={step} className="flex items-center gap-2">
              {index > 0 && <span className="h-px w-5 bg-input" />}
              <NavLink
                to={projectStepHref(data.id, step)}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-1.5 rounded-md",
                    isActive
                      ? "font-semibold text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={cn(
                        "grid size-5 place-items-center rounded-full text-[11px] font-semibold",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : isStepDone(data, step)
                            ? "bg-success-soft text-success"
                            : "bg-accent text-faint",
                      )}
                    >
                      {isStepDone(data, step) && !isActive ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : (
                        index + 1
                      )}
                    </span>
                    {t(`projects.output.steps.${step}`)}
                  </>
                )}
              </NavLink>
            </span>
          ))}
        </nav>
        <ProjectStatusBadge status={data.status} />
      </header>
      {/* Every step page reads the project from here. */}
      <Outlet key={data.id} context={data} />
    </div>
  );
}

// Opening a project lands on the step where its work continues.
export function ProjectWorkspaceIndex() {
  const { projectId = "" } = useParams();
  const project = useProjectQuery(projectId);
  if (!project.data) return null;
  return (
    <Navigate
      replace
      to={projectStepHref(project.data.id, resumeStep(project.data))}
    />
  );
}
