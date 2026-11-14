import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import {
  formatTaskTimestamp,
  taskElapsed,
  taskErrorKey,
  taskKindKey,
} from "../lib/task-format";
import type { Task, TaskAction } from "../types";
import { TaskActions } from "./task-actions";
import { TaskStatusBadge } from "./task-status-badge";
import { TaskKindIcon } from "./task-kind-icon";

// Same layout rules as the accounts table: fixed columns that wrap instead of
// scrolling sideways, and a labelled card per row below the tablet breakpoint.
export function TaskRow({
  task,
  onView,
  onAction,
  now,
}: {
  task: Task;
  onView: (id: string) => void;
  onAction: (id: string, action: TaskAction) => void;
  now: number;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const elapsed = taskElapsed(task, now);

  return (
    <tr
      data-task-id={task.id}
      className="border-b align-top last:border-b-0 max-tablet:grid max-tablet:grid-cols-2 max-tablet:gap-x-4 max-tablet:gap-y-4 max-tablet:p-4 tablet:[&>td]:px-4 tablet:[&>td]:py-4"
    >
      <Cell className="max-tablet:col-span-2">
        <div className="flex items-start gap-3">
          <TaskKindIcon kind={task.kind} />
          <div className="min-w-0">
            <button
              className="text-left font-semibold wrap-anywhere hover:text-primary"
              // The whole title, when it is cut short below.
              title={task.title}
              onClick={() => onView(task.id)}
            >
              {/* A long request is two lines and an ellipsis; the details
                  show all of it. */}
              <span className="line-clamp-2">{task.title}</span>
            </button>
            <p className="mt-0.5 text-xs text-faint">
              {t(taskKindKey(task.kind))}
              {task.sceneNumber !== null &&
                ` · ${t("tasks.scene", { number: task.sceneNumber })}`}
              {task.attempts > 0 &&
                ` · ${t("tasks.attempt", { attempts: task.attempts, max: task.maxAttempts })}`}
            </p>
            <p className="mt-1 font-mono text-[11px] wrap-anywhere text-faint select-all">
              {task.id}
            </p>
          </div>
        </div>
      </Cell>
      <Cell label={t("tasks.fields.status")}>
        <TaskStatusBadge task={task} />
        {task.status === "running" && task.progressPct !== null && (
          <p className="mt-1 font-mono text-xs text-faint">
            {Math.round(task.progressPct)}%
          </p>
        )}
        <div className="mt-2 space-y-0.5 text-xs leading-5">
          {task.status === "running" && task.cancelRequested && (
            <p className="text-muted-foreground">{t("tasks.cancellingNote")}</p>
          )}
          {task.status === "queued" && task.dependsOnId && (
            <p className="text-muted-foreground">{t("tasks.waiting")}</p>
          )}
          {task.error &&
            (task.status === "failed" || task.status === "interrupted") && (
              <p className="line-clamp-2 text-destructive">
                {t(taskErrorKey(task.error.code))}
              </p>
            )}
        </div>
      </Cell>
      <Cell label={t("tasks.fields.account")}>
        <p className="text-xs wrap-anywhere text-muted-foreground">
          {task.accountLabel ??
            t(
              task.accountId
                ? "tasks.deletedAccount"
                : "tasks.unassignedAccount",
            )}
        </p>
      </Cell>
      <Cell label={t("tasks.fields.started")}>
        <p className="text-xs text-muted-foreground">
          {task.startedAt
            ? formatTaskTimestamp(task.startedAt, language)
            : t("tasks.notStarted")}
        </p>
        <p className="mt-0.5 font-mono text-xs text-faint tablet:hidden">
          {elapsed}
        </p>
      </Cell>
      <Cell label={t("tasks.fields.duration")} className="max-tablet:hidden">
        <p className="font-mono text-xs text-muted-foreground">
          {elapsed ?? t("tasks.noAccount")}
        </p>
      </Cell>
      <Cell className="max-tablet:col-span-2">
        <TaskActions task={task} onView={onView} onAction={onAction} />
      </Cell>
    </tr>
  );
}

function Cell({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td className={cn("min-w-0 max-tablet:block", className)}>
      {label && (
        <span className="mb-1.5 block text-[11px] font-medium text-faint tablet:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  );
}
