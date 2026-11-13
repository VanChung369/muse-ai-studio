import { Clapperboard } from "lucide-react";
import { useTranslation } from "react-i18next";

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
import { ProjectCover } from "./project-cover";
import { ProjectStatusBadge } from "./project-status-badge";
import type { Project } from "../types";

type Props = {
  project: Project | undefined;
  open: boolean;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
};

export function ProjectDetailsSheet({
  project,
  open,
  onClose,
  onCloseAutoFocus,
}: Props) {
  const { t } = useTranslation();
  const [language] = useLanguage();

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <SheetContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="gap-0 overflow-y-auto motion-reduce:animate-none data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle className="text-base font-semibold">
            {t(
              project
                ? "projects.details.title"
                : "projects.details.missingTitle",
            )}
          </SheetTitle>
          <SheetDescription className="mt-1 text-xs">
            {t(
              project
                ? "projects.details.description"
                : "projects.details.missingDescription",
            )}
          </SheetDescription>
        </SheetHeader>
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
              <p className="mt-2 text-xs leading-5 text-faint">
                {t("projects.details.previewNote")}
              </p>
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
            <section>
              <h3 className="mb-2 text-sm font-semibold">
                {t("projects.details.idea")}
              </h3>
              <p className="text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground">
                {project.idea || t("projects.details.noIdea")}
              </p>
            </section>
            <section>
              <h3 className="mb-3 text-sm font-semibold">
                {t("projects.details.script")}
              </h3>
              {project.scenes.length > 0 ? (
                <ol className="space-y-3">
                  {project.scenes.map((scene) => (
                    <li
                      key={scene.number}
                      className="rounded-lg border bg-card p-4"
                    >
                      <span className="font-mono text-[10px] text-primary">
                        {t("projects.details.scene", { number: scene.number })}
                      </span>
                      <h4 className="mt-1 text-sm font-medium">
                        {scene.title}
                      </h4>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {scene.prompt}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="flex items-center gap-3 rounded-lg border border-dashed p-5 text-sm text-faint">
                  <Clapperboard
                    className="size-5 shrink-0"
                    aria-hidden="true"
                  />
                  {t("projects.details.noScript")}
                </div>
              )}
            </section>
          </div>
        )}
        <SheetFooter className="border-t px-6 py-4">
          <SheetClose asChild>
            <Button variant="outline">{t("common.close")}</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
