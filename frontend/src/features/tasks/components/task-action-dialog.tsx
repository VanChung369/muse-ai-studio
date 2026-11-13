import { LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTaskAction } from "../hooks/use-task-queries";
import {
  canRetryTask,
  isTaskActive,
  taskActionErrorKey,
} from "../lib/task-format";
import type { Task, TaskAction } from "../types";

export function TaskActionDialog({
  task,
  action,
  onClose,
  onCloseAutoFocus,
}: {
  task: Task;
  action: TaskAction;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const mutation = useTaskAction();
  const [switchAccount, setSwitchAccount] = useState(false);
  const duplicateRisk = task.submitted || task.status === "interrupted";
  const allowed =
    action === "retry"
      ? canRetryTask(task)
      : isTaskActive(task) && !task.cancelRequested;

  async function submit() {
    try {
      await mutation.mutateAsync({
        id: task.id,
        action,
        ...(action === "retry"
          ? { switchAccount, confirmDuplicate: duplicateRisk }
          : {}),
      });
      onClose();
    } catch {
      // Keep the confirmation open with the latest server state and a localized error.
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !mutation.isPending) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={onCloseAutoFocus}
        showCloseButton={!mutation.isPending}
        onEscapeKeyDown={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{t(`tasks.confirm.${action}Title`)}</DialogTitle>
          <DialogDescription>
            {t(`tasks.confirm.${action}Description`)}
          </DialogDescription>
        </DialogHeader>
        <p className="wrap-break-word text-sm font-medium">{task.title}</p>
        {action === "retry" && duplicateRisk && (
          <p className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm leading-6 text-destructive">
            {t("tasks.confirm.duplicateWarning")}
          </p>
        )}
        {action === "retry" && task.kind === "plan_script" && (
          <div className="space-y-2">
            <Label htmlFor={id}>{t("tasks.confirm.account")}</Label>
            <Select
              value={switchAccount ? "auto" : "keep"}
              onValueChange={(value) => setSwitchAccount(value === "auto")}
              disabled={mutation.isPending}
            >
              <SelectTrigger id={id} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">
                  {t("tasks.confirm.keepAccount")}
                </SelectItem>
                <SelectItem value="auto">
                  {t("tasks.confirm.autoAccount")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs leading-5 text-faint">
              {t("tasks.confirm.accountNote")}
            </p>
          </div>
        )}
        {mutation.isError && (
          <p role="alert" className="text-sm leading-6 text-destructive">
            {t(taskActionErrorKey(mutation.error))}
          </p>
        )}
        {!allowed && !mutation.isError && (
          <p role="status" className="text-sm text-muted-foreground">
            {t("tasks.confirm.stateChanged")}
          </p>
        )}
        <DialogFooter>
          <Button
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            variant={action === "cancel" ? "danger" : "default"}
            disabled={mutation.isPending || !allowed}
            onClick={() => void submit()}
          >
            {mutation.isPending && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {t(
              action === "cancel"
                ? "tasks.actions.cancel"
                : duplicateRisk
                  ? "tasks.confirm.confirmRetry"
                  : "tasks.actions.retry",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
