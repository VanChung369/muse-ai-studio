import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { PageLoading } from "@/components/shared/page-loading";
import { ActionBar } from "@/components/ui/action-bar";
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
import { ROUTES } from "@/constants/routes";
import { useLanguage } from "@/hooks/use-language";
import { ApiError } from "@/lib/http";
import { useTaskQuery } from "../hooks/use-task-queries";
import {
  canRetryTask,
  formatTaskTimestamp,
  isTaskActive,
  taskElapsed,
  taskErrorKey,
  taskProjectHref,
} from "../lib/task-format";
import type { TaskAction } from "../types";
import { TaskActionDialog } from "./task-action-dialog";
import { TaskStatusBadge } from "./task-status-badge";

export function TaskDetailsSheet({
  id,
  onClose,
  onCloseAutoFocus,
  initialAction,
}: {
  id: string;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
  initialAction: TaskAction | null;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const query = useTaskQuery(id);
  const [action, setAction] = useState<TaskAction | null>(initialAction);
  const actionButton = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const missing = query.error instanceof ApiError && query.error.status === 404;
  const task = missing ? undefined : query.data;
  const fields = task
    ? {
        id: task.id,
        kind:
          task.kind === "plan_script"
            ? t("tasks.kinds.plan_script")
            : task.kind,
        account:
          task.accountLabel ??
          t(
            task.accountId ? "tasks.deletedAccount" : "tasks.unassignedAccount",
          ),
        created: formatTaskTimestamp(task.createdAt, language),
        started: task.startedAt
          ? formatTaskTimestamp(task.startedAt, language)
          : t("tasks.notStarted"),
        finished: task.finishedAt
          ? formatTaskTimestamp(task.finishedAt, language)
          : t("tasks.notFinished"),
        elapsed:
          taskElapsed(task, query.dataUpdatedAt) ?? t("tasks.notStarted"),
        attempts: `${task.attempts} / ${task.maxAttempts}`,
        ...(task.sceneNumber !== null
          ? { scene: String(task.sceneNumber) }
          : {}),
        ...(task.dependsOnId ? { dependency: task.dependsOnId } : {}),
      }
    : null;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        onCloseAutoFocus={onCloseAutoFocus}
        className="gap-0 overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-xl"
      >
        <SheetHeader className="border-b px-6 py-5 pr-12">
          <SheetTitle>
            {t(missing ? "tasks.details.missing" : "tasks.details.title")}
          </SheetTitle>
          <SheetDescription>
            {t(
              missing
                ? "tasks.details.missingDescription"
                : "tasks.details.description",
            )}
          </SheetDescription>
        </SheetHeader>
        {query.isPending && <PageLoading />}
        {query.isError && !missing && (
          <div role="alert" className="space-y-3 p-6">
            <p className="text-sm text-destructive">{t("tasks.errors.load")}</p>
            <ActionBar>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t("common.retry")}
              </Button>
            </ActionBar>
          </div>
        )}
        {task && fields && (
          <div className="space-y-6 p-6">
            <div className="space-y-3">
              <TaskStatusBadge task={task} />
              <h2 className="text-xl leading-7 font-semibold wrap-break-word">
                {task.title}
              </h2>
              {task.status === "running" && task.progressPct !== null && (
                <progress
                  aria-label={t("tasks.progress")}
                  value={task.progressPct}
                  max={100}
                  className="h-2 w-full accent-primary"
                />
              )}
              {task.cancelRequested && task.status === "running" && (
                <p className="text-sm leading-6 text-muted-foreground">
                  {t("tasks.cancellingNote")}
                </p>
              )}
            </div>
            {task.error && (
              <section className="space-y-2 rounded-xl border border-destructive/30 bg-destructive-soft p-4">
                <h3 className="font-medium text-destructive">
                  {t("tasks.details.problem")}
                </h3>
                <p className="text-sm leading-6">
                  {t(taskErrorKey(task.error.code))}
                </p>
                <p className="font-mono text-xs wrap-break-word text-muted-foreground">
                  {task.error.code}
                </p>
                {task.suggestedAction && (
                  <p className="text-sm leading-6 text-muted-foreground">
                    {t(`tasks.suggestions.${task.suggestedAction}`)}
                  </p>
                )}
              </section>
            )}
            {task.status === "succeeded" && task.kind === "plan_script" && (
              <p className="rounded-xl border border-success/30 bg-success-soft p-4 text-sm leading-6 text-success">
                {t("tasks.details.scriptReady")}
              </p>
            )}
            <dl className="grid grid-cols-1 gap-4 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
              {Object.entries(fields).map(([field, value]) => (
                <div key={field} className="min-w-0">
                  <dt className="text-xs text-faint">
                    {t(`tasks.fields.${field as keyof typeof fields}`)}
                  </dt>
                  <dd className="mt-1 wrap-break-word">{value}</dd>
                </div>
              ))}
            </dl>
            <ActionBar>
              {(task.suggestedAction === "relogin" ||
                task.suggestedAction === "check_proxy") && (
                <Button variant="outline" asChild>
                  <Link to={ROUTES.ACCOUNTS}>
                    {t("tasks.actions.accounts")}
                  </Link>
                </Button>
              )}
              {task.projectId && (
                <Button variant="outline" asChild>
                  <Link to={taskProjectHref(task.projectId)}>
                    {t("tasks.actions.project")}
                  </Link>
                </Button>
              )}
            </ActionBar>
          </div>
        )}
        <SheetFooter className="border-t px-6 py-4">
          <SheetClose asChild>
            <Button ref={closeButton} variant="outline">
              {t("common.close")}
            </Button>
          </SheetClose>
          {task?.deletable && (
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setAction("delete")}
            >
              <Trash2 aria-hidden="true" />
              {t("tasks.actions.delete")}
            </Button>
          )}
          {task && isTaskActive(task) && (
            <Button
              ref={actionButton}
              variant="destructive"
              disabled={task.cancelRequested}
              onClick={() => setAction("cancel")}
            >
              {t(
                task.cancelRequested
                  ? "tasks.status.cancelling"
                  : "tasks.actions.cancel",
              )}
            </Button>
          )}
          {task && canRetryTask(task) && (
            <Button ref={actionButton} onClick={() => setAction("retry")}>
              {t("tasks.actions.retry")}
            </Button>
          )}
        </SheetFooter>
        {task && action && (
          <TaskActionDialog
            key={`${task.id}-${action}`}
            task={task}
            action={action}
            onClose={() => setAction(null)}
            // The task is gone: the sheet has nothing left to show.
            onDeleted={onClose}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const target = actionButton.current;
              if (target && !target.disabled) target.focus();
              else closeButton.current?.focus();
            }}
          />
        )}
      </SheetContent>
    </Sheet>
  );
}
