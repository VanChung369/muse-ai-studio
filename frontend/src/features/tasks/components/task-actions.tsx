import { RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { canRetryTask, isTaskActive } from "../lib/task-format";
import type { Task, TaskAction } from "../types";

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
  return (
    <ActionBar>
      <Button
        variant="ghost"
        size="sm"
        aria-label={t("tasks.detailsFor", { title: task.title })}
        onClick={() => onView(task.id)}
      >
        {t("tasks.actions.details")}
      </Button>
      {withSuggestion &&
        (task.suggestedAction === "relogin" ||
          task.suggestedAction === "check_proxy") && (
          <Button variant="outline" size="sm" asChild>
            <Link to={ROUTES.ACCOUNTS}>{t("tasks.actions.accounts")}</Link>
          </Button>
        )}
      {isTaskActive(task) && (
        <Button
          variant="outline"
          size="sm"
          disabled={task.cancelRequested}
          onClick={() => onAction(task.id, "cancel")}
        >
          <Square aria-hidden="true" />
          {t(
            task.cancelRequested
              ? "tasks.status.cancelling"
              : "tasks.actions.cancel",
          )}
        </Button>
      )}
      {canRetryTask(task) && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onAction(task.id, "retry")}
        >
          <RotateCcw aria-hidden="true" />
          {t("tasks.actions.retry")}
        </Button>
      )}
    </ActionBar>
  );
}
