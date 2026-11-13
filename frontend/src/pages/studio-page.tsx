import { ArrowLeft, Captions, Clapperboard, Film, Music } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";

import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { ProjectStatusBadge } from "@/features/projects/components/project-status-badge";
import { RenderVideo } from "@/features/projects/components/render-scene-list";
import { useProjectRender } from "@/features/projects/hooks/use-project-render";
import { useProjectQuery } from "@/features/projects/hooks/use-project-queries";
import { downloadHref } from "@/features/projects/lib/project-render";
import { projectDetailsHref } from "@/features/projects/lib/project-list";
import type { Project, ProjectRender } from "@/features/projects/types";
import { TaskStatusBadge } from "@/features/tasks/components/task-status-badge";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

// Full-page workspace for one project (design board 12): scenes on the left,
// preview in the middle, the selected scene's details on the right. Editing
// tools (music, subtitles) are listed but not built yet.
export function StudioPage() {
  const { t } = useTranslation();
  const { projectId = "" } = useParams();
  const project = useProjectQuery(projectId);
  const render = useProjectRender(projectId);
  useDocumentTitle(project.data?.name ?? t("projects.studio.title"));

  if (project.isPending) return <PageLoading />;
  if (!project.data)
    return (
      <div role="alert" className="space-y-3 p-8">
        <p className="text-sm text-muted-foreground">
          {t("projects.details.loadError")}
        </p>
        <Button variant="outline" asChild>
          <Link to={projectDetailsHref(projectId)}>
            {t("projects.studio.back")}
          </Link>
        </Button>
      </div>
    );
  return <Studio project={project.data} render={render.query.data} />;
}

type Selection = number | "film";

function Studio({
  project,
  render,
}: {
  project: Project;
  render: ProjectRender | undefined;
}) {
  const { t } = useTranslation();
  // The finished film when there is one, otherwise the first scene.
  const [chosen, setChosen] = useState<Selection | null>(null);
  const selection: Selection =
    chosen ?? (render?.videoUrl ? "film" : (project.scenes[0]?.number ?? 1));
  const scene = project.scenes.find((item) => item.number === selection);
  const rendered = render?.scenes.find((item) => item.number === selection);
  const video =
    selection === "film" ? render?.videoUrl : (rendered?.videoUrl ?? null);

  return (
    <div className="flex w-full max-w-400 flex-col gap-5 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7">
      <header className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link
            to={projectDetailsHref(project.id)}
            aria-label={t("projects.studio.back")}
          >
            <ArrowLeft aria-hidden="true" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl leading-7 font-semibold">
            {project.name}
          </h1>
          <p className="text-xs text-muted-foreground">
            {[
              project.aspectRatio,
              t("projects.sceneCount", { count: project.sceneCount }),
              formatDuration(project.durationSeconds),
            ].join(" · ")}
          </p>
        </div>
        <ProjectStatusBadge status={project.status} />
      </header>

      <div className="grid gap-5 desktop:grid-cols-[17rem_minmax(0,1fr)_19rem]">
        <nav aria-label={t("projects.studio.scenes")} className="min-w-0">
          <h2 className="mb-2 text-xs font-medium text-faint">
            {t("projects.studio.scenes")}
          </h2>
          <ol className="flex gap-2 overflow-x-auto desktop:flex-col desktop:overflow-visible">
            {render?.videoUrl && (
              <li className="shrink-0">
                <SceneButton
                  selected={selection === "film"}
                  onSelect={() => setChosen("film")}
                  thumbnail={project.coverUrl}
                  label={<Film className="size-3.5" aria-hidden="true" />}
                  title={t("projects.render.finalVideo")}
                  detail={formatDuration(project.durationSeconds)}
                />
              </li>
            )}
            {project.scenes.map((item) => {
              const state = render?.scenes.find(
                (entry) => entry.number === item.number,
              );
              return (
                <li key={item.number} className="shrink-0">
                  <SceneButton
                    selected={selection === item.number}
                    onSelect={() => setChosen(item.number)}
                    thumbnail={state?.thumbnailUrl}
                    label={item.number}
                    title={item.title}
                    detail={formatDuration(item.durationSeconds)}
                  />
                </li>
              );
            })}
          </ol>
        </nav>

        <section aria-label={t("projects.studio.preview")} className="min-w-0">
          {video ? (
            <div className="space-y-3">
              <RenderVideo
                key={video}
                muted={project.mute}
                src={video}
                poster={
                  selection === "film"
                    ? project.coverUrl
                    : rendered?.thumbnailUrl
                }
                aspectRatio={project.aspectRatio}
                label={scene?.title ?? t("projects.render.finalVideo")}
              />
              <Button variant="outline" asChild>
                <a href={downloadHref(video)} download>
                  {t(
                    selection === "film"
                      ? "projects.render.downloadVideo"
                      : "projects.render.downloadScene",
                  )}
                </a>
              </Button>
            </div>
          ) : (
            <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-input px-6 text-center">
              <div>
                <Clapperboard
                  className="mx-auto mb-3 size-7 text-faint"
                  aria-hidden="true"
                />
                <p className="text-sm text-muted-foreground">
                  {t("projects.studio.noClip")}
                </p>
              </div>
            </div>
          )}
        </section>

        <aside className="min-w-0 space-y-4">
          {scene && (
            <section className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 text-sm font-semibold wrap-break-word">
                  {t("projects.details.scene", { number: scene.number })} ·{" "}
                  {scene.title}
                </h2>
                {rendered?.task && <TaskStatusBadge task={rendered.task} />}
              </div>
              <Field label={t("projects.studio.prompt")}>{scene.prompt}</Field>
              <Field label={t("projects.studio.narration")}>
                {scene.narration || t("projects.studio.noNarration")}
              </Field>
              {rendered?.task?.accountLabel && (
                <Field label={t("projects.studio.account")}>
                  {rendered.task.accountLabel}
                </Field>
              )}
            </section>
          )}
          <section className="space-y-3 rounded-lg border bg-card p-4">
            <h2 className="text-sm font-semibold">
              {t("projects.studio.tools")}
            </h2>
            <p className="text-xs leading-5 text-muted-foreground">
              {t("projects.studio.toolsNote")}
            </p>
            {/* Not built yet: shown so the workspace's direction is clear. */}
            {[
              { icon: Music, label: t("projects.studio.music") },
              { icon: Captions, label: t("projects.studio.subtitles") },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 rounded-md border border-dashed border-input px-3 py-2 text-[13px] text-faint"
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="min-w-0 flex-1">{label}</span>
                <span className="text-xs">{t("projects.studio.soon")}</span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}

function SceneButton({
  selected,
  onSelect,
  thumbnail,
  label,
  title,
  detail,
}: {
  selected: boolean;
  onSelect: () => void;
  thumbnail: string | null | undefined;
  label: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex w-56 items-center gap-3 rounded-lg border p-2 text-left desktop:w-full",
        selected
          ? "border-primary-line bg-primary-soft"
          : "bg-card hover:bg-secondary",
      )}
    >
      <span className="relative grid h-11 w-18 shrink-0 place-items-center overflow-hidden rounded-md bg-background font-mono text-xs text-muted-foreground">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          label
        )}
        {thumbnail && (
          <span className="absolute top-0.5 left-0.5 grid min-w-4 place-items-center rounded bg-black/70 px-1 text-[10px] leading-4 text-white">
            {label}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className="block font-mono text-[11px] text-faint">{detail}</span>
      </span>
    </button>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="mb-1 text-xs text-faint">{label}</p>
      <p className="text-[13px] leading-6 whitespace-pre-wrap text-muted-foreground">
        {children}
      </p>
    </div>
  );
}
