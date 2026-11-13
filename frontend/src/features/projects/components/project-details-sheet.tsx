import { Clapperboard, Settings2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useLanguage } from "@/hooks/use-language";
import { formatDuration } from "@/lib/format";
import { projectTasksHref } from "@/features/tasks/lib/task-format";
import { projectWorkspaceHref } from "../lib/project-list";
import { isRenderActive } from "../lib/project-render";
import { DeleteProjectDialog } from "./delete-project-dialog";
import { EditProjectDialog } from "./edit-project-dialog";
import { ProjectCover } from "./project-cover";
import { ProjectRenderSection } from "./project-render-section";
import { ProjectScriptSection } from "./project-script-section";
import { ProjectStatusBadge } from "./project-status-badge";
import type { Project } from "../types";

type Props = {
  project: Project | undefined;
  open: boolean;
  isLoading: boolean;
  isMissing: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  onClose: () => void;
  onDeleted: (id: string, name: string) => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function ProjectDetailsSheet({
  project,
  open,
  isLoading,
  isMissing,
  isError,
  isFetching,
  onRetry,
  onClose,
  onDeleted,
  onCloseAutoFocus,
}: Props) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const [editing, setEditing] = useState(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="gap-0 overflow-hidden motion-reduce:animate-none data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="text-base font-semibold">
            {t(
              isMissing
                ? "projects.details.missingTitle"
                : "projects.details.title",
            )}
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs">
            {t(
              isMissing
                ? "projects.details.missingDescription"
                : "projects.details.description",
            )}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {isLoading && <PageLoading />}
          {isError && (
            <div role="alert" className="space-y-3 p-6">
              <p className="text-sm text-muted-foreground">
                {t("projects.details.loadError")}
              </p>
              <Button variant="outline" disabled={isFetching} onClick={onRetry}>
                {t("common.retry")}
              </Button>
            </div>
          )}
          {project && (
            <div className="space-y-6 p-6">
              <div>
                <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                  <h2 className="min-w-0 flex-1 text-xl leading-7 font-semibold wrap-break-word">
                    {project.name}
                  </h2>
                  <ProjectStatusBadge status={project.status} />
                </div>
                <ProjectCover project={project} />
                {project.completedScenes === 0 && (
                  <p className="mt-2 text-xs leading-5 text-faint">
                    {t("projects.details.previewNote")}
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-4 rounded-lg border bg-card p-4 text-sm">
                <div>
                  <dt className="text-xs text-faint">
                    {t("projects.details.duration")}
                  </dt>
                  <dd className="mt-1 font-mono">
                    {formatDuration(project.durationSeconds)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">
                    {t("projects.details.ratio")}
                  </dt>
                  <dd className="mt-1 font-mono">{project.aspectRatio}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">
                    {t("projects.details.scenes")}
                  </dt>
                  <dd className="mt-1 font-mono">{project.sceneCount}</dd>
                </div>
                <div>
                  <dt className="text-xs text-faint">
                    {t("projects.details.updated")}
                  </dt>
                  <dd className="mt-1 text-xs leading-5">
                    {new Intl.DateTimeFormat(language, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(project.updatedAt))}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="min-w-0 text-xs leading-5 text-muted-foreground">
                  {t("projects.settings.summary", {
                    language: t(
                      `projects.settings.languages.${project.language}`,
                    ),
                    look: t(`projects.settings.looks.${project.look}`),
                    continuity: t(
                      `projects.settings.continuities.${project.continuity}`,
                    ),
                  })}
                  {project.mute && ` · ${t("projects.settings.muted")}`}
                </p>
                {/* While a render runs nothing about the project can change. */}
                {!isRenderActive(project.status) && (
                  <Button variant="outline" onClick={() => setEditing(true)}>
                    <Settings2 aria-hidden="true" />
                    {t("projects.settings.open")}
                  </Button>
                )}
              </div>
              {editing && (
                <EditProjectDialog
                  project={project}
                  onClose={() => setEditing(false)}
                />
              )}
              <section>
                <h3 className="mb-2 text-sm font-semibold">
                  {t("projects.details.idea")}
                </h3>
                <p className="text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground">
                  {project.idea || t("projects.details.noIdea")}
                </p>
              </section>
              <ProjectRenderSection
                key={`render-${project.id}`}
                project={project}
              />
              <ProjectScriptSection key={project.id} project={project} />
            </div>
          )}
        </div>
        <SheetFooter className="border-t px-6 py-4">
          <SheetClose asChild>
            <Button variant="outline">{t("common.close")}</Button>
          </SheetClose>
          {project && (
            <Button variant="outline" asChild>
              <Link to={projectWorkspaceHref(project.id)}>
                <Clapperboard aria-hidden="true" />
                {t("projects.workspace.open")}
              </Link>
            </Button>
          )}
          {project && (
            <Button variant="outline" asChild>
              <Link to={projectTasksHref(project.id)}>
                {t("tasks.actions.projectTasks")}
              </Link>
            </Button>
          )}
          {project && (
            <DeleteProjectDialog project={project} onDeleted={onDeleted} />
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
