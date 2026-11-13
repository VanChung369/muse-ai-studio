import { useTranslation } from "react-i18next";

import type { RenderControls } from "../hooks/use-render-controls";
import { renderErrorKey } from "../lib/project-render";
import type { Project, ProjectRender } from "../types";
import { RenderConfirmDialog } from "./render-confirm-dialog";

// The confirmations behind start, cancel, continue and "render again".
export function RenderDialogs({
  project,
  render,
  controls,
}: {
  project: Project;
  render: ProjectRender;
  controls: RenderControls;
}) {
  const { t } = useTranslation();
  const { dialog, restartFrom, start, cancel, resume, restart, close } =
    controls;

  return (
    <>
      <RenderConfirmDialog
        open={dialog === "start"}
        onOpenChange={close}
        title={t("projects.render.start.title", { count: render.sceneCount })}
        description={t("projects.render.start.description")}
        dismissLabel={t("projects.render.start.review")}
        confirmLabel={t("projects.render.start.action")}
        pendingLabel={t("projects.render.start.starting")}
        pending={start.isPending}
        error={start.isError ? t(renderErrorKey(start.error)) : undefined}
        onConfirm={() => start.mutate(project.id, { onSuccess: close })}
      >
        <dl className="space-y-3 rounded-lg border bg-card p-3 text-[13px]">
          <div>
            <dt className="text-xs text-faint">
              {t("projects.render.start.account")}
            </dt>
            <dd className="mt-1">
              {t("projects.render.start.automatic", {
                count: render.usableAccounts,
              })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">{t("projects.render.look")}</dt>
            <dd className="mt-1">
              {t(`projects.settings.looks.${project.look}`)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-faint">
              {t("projects.render.continuity")}
            </dt>
            <dd className="mt-1">
              {t(`projects.settings.continuities.${project.continuity}`)}
            </dd>
          </div>
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">
          {t("projects.render.start.locked")}
        </p>
      </RenderConfirmDialog>
      {restartFrom !== null && (
        <RenderConfirmDialog
          open
          onOpenChange={close}
          title={t("projects.render.restart.title", { number: restartFrom })}
          description={[
            t(
              restartFrom === 1
                ? "projects.render.restart.all"
                : restartFrom === render.sceneCount
                  ? "projects.render.restart.last"
                  : "projects.render.restart.range",
              { number: restartFrom, count: render.sceneCount },
            ),
            restartFrom === 2 && t("projects.render.restart.keptOne"),
            restartFrom > 2 &&
              t("projects.render.restart.keptRange", {
                previous: restartFrom - 1,
              }),
          ]
            .filter(Boolean)
            .join(" ")}
          dismissLabel={t("projects.render.restart.keep")}
          confirmLabel={t("projects.render.restart.confirm", {
            count: render.sceneCount - restartFrom + 1,
          })}
          pendingLabel={t("projects.render.restart.restarting")}
          pending={restart.isPending}
          error={restart.isError ? t(renderErrorKey(restart.error)) : undefined}
          onConfirm={() =>
            restart.mutate(
              { id: project.id, fromScene: restartFrom },
              { onSuccess: close },
            )
          }
        >
          <p className="text-xs leading-5 text-muted-foreground">
            {t("projects.render.restart.cost")}
          </p>
        </RenderConfirmDialog>
      )}
      <RenderConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={close}
        title={t("projects.render.cancel.title")}
        description={t("projects.render.cancel.description")}
        dismissLabel={t("projects.render.cancel.keep")}
        confirmLabel={t("projects.render.cancel.action")}
        pendingLabel={t("projects.render.cancel.cancelling")}
        pending={cancel.isPending}
        danger
        error={cancel.isError ? t(renderErrorKey(cancel.error)) : undefined}
        onConfirm={() => cancel.mutate(project.id, { onSuccess: close })}
      />
      <RenderConfirmDialog
        open={dialog === "resume"}
        onOpenChange={close}
        title={t("projects.render.resume.title")}
        description={t("projects.render.resume.description")}
        dismissLabel={t("common.cancel")}
        confirmLabel={t("projects.render.resume.confirm")}
        pendingLabel={t("projects.render.resume.resuming")}
        pending={resume.isPending}
        error={resume.isError ? t(renderErrorKey(resume.error)) : undefined}
        onConfirm={() =>
          resume.mutate(
            { id: project.id, confirmDuplicate: true },
            { onSuccess: close },
          )
        }
      />
    </>
  );
}
