import {
  ArrowRight,
  Clapperboard,
  Film,
  Layers,
  Music,
  Palette,
  Pencil,
  Plus,
  Sparkles,
  TriangleAlert,
  User,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router";

import { Button } from "@/components/ui/button";
import { GenerateScriptDialog } from "@/features/projects/components/generate-script-dialog";
import { ProjectScriptEditor } from "@/features/projects/components/project-script-editor";
import { RenderVideo } from "@/features/projects/components/render-scene-list";
import { useProjectRender } from "@/features/projects/hooks/use-project-render";
import { projectStepHref } from "@/features/projects/lib/project-list";
import { isScriptEditable } from "@/features/projects/lib/project-script";
import type { Project } from "@/features/projects/types";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

type Scene = Project["scenes"][number];
const pad = (number: number) => String(number).padStart(2, "0");

// Step 2 of a project, "Kịch bản & cảnh" (design board 12): the scenes on the
// left, the storyboard or the selected scene in the middle, and the
// description every scene shares on the right.
export function ProjectScriptPage() {
  const { t } = useTranslation();
  const project = useOutletContext<Project>();
  const render = useProjectRender(project.id).query.data;
  // Null shows the whole project (the storyboard).
  const [chosen, setChosen] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [editing, setEditing] = useState(false);
  const canEdit = isScriptEditable(project.status);
  const scene = project.scenes.find((item) => item.number === chosen) ?? null;
  const total = project.scenes.reduce(
    (sum, item) => sum + item.durationSeconds,
    0,
  );
  const thumbnail = (number: number) =>
    render?.scenes.find((item) => item.number === number)?.thumbnailUrl ?? null;

  const actions = canEdit && (
    <>
      <Button variant="outline" onClick={() => setGenerating(true)}>
        <Sparkles aria-hidden="true" />
        {t("projects.generation.open")}
      </Button>
      <Button variant="outline" onClick={() => setEditing(true)}>
        {project.scenes.length > 0 ? (
          <Pencil aria-hidden="true" />
        ) : (
          <Plus aria-hidden="true" />
        )}
        {t(
          project.scenes.length > 0
            ? "projects.script.edit"
            : "projects.script.create",
        )}
      </Button>
    </>
  );

  return (
    <>
      {project.scenes.length > 0 ? (
        <div className="grid desktop:grid-cols-[18rem_minmax(0,1fr)_22rem]">
          <nav
            aria-label={t("projects.output.steps.script")}
            className="min-w-0 space-y-4 border-b p-3 desktop:border-r desktop:border-b-0"
          >
            <button
              type="button"
              aria-pressed={scene === null}
              onClick={() => setChosen(null)}
              className={cn(
                "flex w-full items-start gap-3 rounded-lg border p-3 text-left",
                scene === null
                  ? "border-primary-line bg-primary-soft"
                  : "bg-card hover:bg-secondary",
              )}
            >
              <Layers className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">
                  {t("projects.workspace.script.whole")}
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  {t("projects.workspace.script.wholeHint")}
                </span>
              </span>
            </button>
            <div>
              <div className="mb-2 flex items-baseline justify-between gap-2 px-1 text-[11px] text-faint">
                <h2 className="font-semibold tracking-wider uppercase">
                  {t("projects.details.scenes")}
                </h2>
                <span>
                  {t("projects.sceneCount", { count: project.scenes.length })} ·{" "}
                  {formatDuration(total)}
                </span>
              </div>
              <ol className="flex gap-1 overflow-x-auto desktop:flex-col desktop:overflow-visible">
                {project.scenes.map((item) => (
                  <li key={item.number} className="shrink-0">
                    <button
                      type="button"
                      aria-pressed={item.number === scene?.number}
                      onClick={() => setChosen(item.number)}
                      className={cn(
                        "flex w-60 items-center gap-3 rounded-lg p-2 text-left desktop:w-full",
                        item.number === scene?.number
                          ? "bg-primary-soft"
                          : "hover:bg-secondary",
                      )}
                    >
                      <span className="w-5 shrink-0 font-mono text-[11px] text-faint">
                        {pad(item.number)}
                      </span>
                      <SceneThumb
                        src={thumbnail(item.number)}
                        className="h-10 w-18"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">
                          {item.title}
                        </span>
                        <span className="block font-mono text-[11px] text-faint">
                          {formatDuration(item.durationSeconds)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </nav>

          {scene ? (
            <SceneDetail
              scene={scene}
              project={project}
              video={
                render?.scenes.find((item) => item.number === scene.number) ??
                null
              }
              onEdit={canEdit ? () => setEditing(true) : undefined}
            />
          ) : (
            <section className="min-w-0 space-y-6 p-4 tablet:p-6">
              <div>
                <h2 className="text-lg font-semibold">
                  {t("projects.workspace.script.storyboard")}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t("projects.workspace.script.storyboardHint")}
                </p>
              </div>
              <ol className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3">
                {project.scenes.map((item) => (
                  <li key={item.number}>
                    <button
                      type="button"
                      onClick={() => setChosen(item.number)}
                      className="flex h-full w-full flex-col gap-2.5 rounded-lg border bg-card p-2.5 text-left hover:border-input-hover hover:bg-secondary"
                    >
                      <span className="relative block aspect-video w-full overflow-hidden rounded-md border bg-background">
                        {thumbnail(item.number) ? (
                          <img
                            src={thumbnail(item.number) ?? undefined}
                            alt=""
                            loading="lazy"
                            className="size-full object-cover"
                          />
                        ) : (
                          <span className="absolute bottom-1.5 left-2.5 font-mono text-2xl font-semibold text-faint/40">
                            {pad(item.number)}
                          </span>
                        )}
                      </span>
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-[13px] font-semibold">
                          {item.title}
                        </span>
                        <span className="shrink-0 font-mono text-[11px] text-faint">
                          {formatDuration(item.durationSeconds)}
                        </span>
                      </span>
                      <span className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                        {item.prompt}
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
              <div>
                <div className="mb-2 flex items-baseline justify-between gap-2 text-xs text-faint">
                  <h3>{t("projects.workspace.script.timeline")}</h3>
                  <span className="font-mono">
                    0:00 – {formatDuration(total)}
                  </span>
                </div>
                {/* Each block is as wide as its scene is long. */}
                <ol className="flex gap-1">
                  {project.scenes.map((item) => (
                    <li
                      key={item.number}
                      style={{ flexGrow: item.durationSeconds }}
                      className="min-w-0 basis-0"
                    >
                      <button
                        type="button"
                        title={item.title}
                        aria-label={t("projects.details.scene", {
                          number: item.number,
                        })}
                        onClick={() => setChosen(item.number)}
                        className="h-8 w-full rounded-md bg-accent font-mono text-[11px] text-muted-foreground hover:bg-surface-4 hover:text-foreground"
                      >
                        {pad(item.number)}
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
          )}

          <aside className="min-w-0 space-y-5 border-t p-5 desktop:border-t-0 desktop:border-l">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold">
                {t("projects.workspace.script.shared")}
              </h2>
              {canEdit && (
                <Link
                  to={projectStepHref(project.id, "idea")}
                  className="text-xs text-primary hover:text-primary-hover hover:underline"
                >
                  {t("projects.workspace.script.editShared")}
                </Link>
              )}
            </div>
            <p className="flex gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs leading-5 text-muted-foreground">
              <TriangleAlert
                className="mt-0.5 size-3.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              {canEdit
                ? t("projects.workspace.script.appliesToAll", {
                    total: project.scenes.length,
                  })
                : t("projects.script.locked")}
            </p>
            <Shared label={t("projects.workspace.script.story")} icon={Film}>
              {project.idea}
            </Shared>
            <Shared label={t("projects.form.characters")} icon={User}>
              {project.characterBible}
            </Shared>
            <Shared label={t("projects.form.visualStyle")} icon={Palette}>
              {project.visualStyle}
            </Shared>
            <Shared label={t("projects.form.music")} icon={Music}>
              {project.music}
            </Shared>
            {project.references.length > 0 && (
              <div>
                <p className="mb-2 text-xs text-muted-foreground">
                  {t("projects.form.references")}
                </p>
                <ul className="flex flex-wrap gap-2">
                  {project.references.map((reference) => (
                    <li
                      key={reference.id}
                      title={reference.name}
                      className="h-14 w-20 overflow-hidden rounded-md border bg-background"
                    >
                      {reference.mime.startsWith("image/") ? (
                        <img
                          src={reference.url}
                          alt={reference.name}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <video
                          src={reference.url}
                          muted
                          playsInline
                          preload="metadata"
                          aria-label={reference.name}
                          className="size-full object-cover"
                        />
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-2 border-t pt-5">
              {actions}
              <Button asChild>
                <Link to={projectStepHref(project.id, "render")}>
                  {t("projects.workspace.script.toRender")}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </div>
          </aside>
        </div>
      ) : (
        <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-6 py-20 text-center">
          <Clapperboard className="size-8 text-faint" aria-hidden="true" />
          <p className="text-sm leading-6 text-muted-foreground">
            {t("projects.workspace.script.empty")}
          </p>
          <div className="flex flex-wrap justify-center gap-2">{actions}</div>
        </div>
      )}
      {generating && (
        <GenerateScriptDialog
          project={project}
          onClose={() => setGenerating(false)}
        />
      )}
      {editing && (
        <ProjectScriptEditor project={project} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

function SceneThumb({
  src,
  className,
}: {
  src: string | null;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block shrink-0 overflow-hidden rounded-md border bg-background",
        className,
      )}
    >
      {src && (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      )}
    </span>
  );
}

// One scene read in full: its clip once rendered, its prompt and narration.
function SceneDetail({
  scene,
  project,
  video,
  onEdit,
}: {
  scene: Scene;
  project: Project;
  video: { videoUrl: string | null; thumbnailUrl: string | null } | null;
  onEdit?: () => void;
}) {
  const { t } = useTranslation();

  return (
    <section className="min-w-0 space-y-5 p-4 tablet:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[11px] text-primary">
            {t("projects.details.scene", { number: scene.number })} ·{" "}
            {t("projects.script.seconds", { count: scene.durationSeconds })}
          </p>
          <h2 className="mt-1 text-lg font-semibold wrap-break-word">
            {scene.title}
          </h2>
        </div>
        {onEdit && (
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil aria-hidden="true" />
            {t("projects.script.edit")}
          </Button>
        )}
      </div>
      {video?.videoUrl ? (
        <RenderVideo
          key={video.videoUrl}
          src={video.videoUrl}
          poster={video.thumbnailUrl}
          muted={project.mute}
          aspectRatio={project.aspectRatio}
          label={scene.title}
        />
      ) : (
        <div className="grid aspect-video place-items-center rounded-lg border border-dashed border-input px-6 text-center">
          <div>
            <Clapperboard
              className="mx-auto mb-3 size-7 text-faint"
              aria-hidden="true"
            />
            <p className="text-sm text-muted-foreground">
              {t("projects.workspace.script.notRendered")}
            </p>
          </div>
        </div>
      )}
      <Block label={t("projects.script.prompt")}>{scene.prompt}</Block>
      {scene.narration && (
        <Block label={t("projects.script.narration")}>{scene.narration}</Block>
      )}
    </section>
  );
}

function Block({
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

// A part of the description every scene shares, shown as the field it is.
function Shared({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: string;
}) {
  const { t } = useTranslation();

  return (
    <div>
      <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
        {label}
      </p>
      <p
        className={cn(
          "max-h-40 overflow-y-auto rounded-lg border bg-card px-3 py-2 text-[13px] leading-6 whitespace-pre-wrap",
          !children && "text-faint",
        )}
      >
        {children || t("projects.workspace.script.none")}
      </p>
    </div>
  );
}
