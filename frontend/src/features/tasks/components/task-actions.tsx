import { Eye, RotateCcw, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { canRetryTask, isTaskActive } from "../lib/task-format";
import type { Task, TaskAction } from "../types";

// In the table each action keeps a column of its own (details, stop or
// retry, delete), so the buttons line up from row to row whichever of them
// a task offers; there they are icons, named by their label and tooltip.
// Below the tablet breakpoint a task is a card and they are labelled
// buttons in one row.
const ICON = "tablet:w-8 tablet:justify-self-center tablet:px-0";
const LABEL = "tablet:sr-only";

export function TaskActions({
  task,
  onView,
  onAction,
  withSuggestion = false,
}: {
  task: Task;
  onView: (id: string) => void;
  onAction: (id: string, action: TaskAction) => void;
  withSuggestion?: boolean;
}) {
  const { t } = useTranslation();
  const stopLabel = t(
    task.cancelRequested ? "tasks.status.cancelling" : "tasks.actions.cancel",
  );
  return (
    <ActionBar className="tablet:grid tablet:grid-cols-[repeat(3,2rem)] tablet:gap-1">
      <Button
        variant="ghost"
        size="sm"
        className={`${ICON} tablet:col-start-1`}
        aria-label={t("tasks.detailsFor", { title: task.title })}
        title={t("tasks.actions.details")}
        onClick={() => onView(task.id)}
      >
        <Eye aria-hidden="true" className="max-tablet:hidden" />
        <span className={LABEL}>{t("tasks.actions.details")}</span>
      </Button>
      {isTaskActive(task) && (
        <Button
          variant="outline"
          size="sm"
          className={`${ICON} tablet:col-start-2`}
          title={stopLabel}
          disabled={task.cancelRequested}
          onClick={() => onAction(task.id, "cancel")}
        >
          <Square aria-hidden="true" />
          <span className={LABEL}>{stopLabel}</span>
        </Button>
      )}
      {canRetryTask(task) && (
        <Button
          variant="outline"
          size="sm"
          className={`${ICON} tablet:col-start-2`}
          title={t("tasks.actions.retry")}
          onClick={() => onAction(task.id, "retry")}
        >
          <RotateCcw aria-hidden="true" />
          <span className={LABEL}>{t("tasks.actions.retry")}</span>
        </Button>
      )}
      {task.deletable && (
        <Button
          variant="ghost"
          size="sm"
          className={`${ICON} text-destructive hover:text-destructive tablet:col-start-3`}
          aria-label={t("tasks.deleteFor", { title: task.title })}
          title={t("tasks.actions.delete")}
          onClick={() => onAction(task.id, "delete")}
        >
          <Trash2 aria-hidden="true" />
          <span className={LABEL}>{t("tasks.actions.delete")}</span>
        </Button>
      )}
      {withSuggestion &&
        (task.suggestedAction === "relogin" ||
          task.suggestedAction === "check_proxy") && (
          <Button
            variant="outline"
            size="sm"
            className="tablet:col-span-3 tablet:justify-self-end"
            asChild
          >
            <Link to={ROUTES.ACCOUNTS}>{t("tasks.actions.accounts")}</Link>
          </Button>
        )}
    </ActionBar>
  );
}
