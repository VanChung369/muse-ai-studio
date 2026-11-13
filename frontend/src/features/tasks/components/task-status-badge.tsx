import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import { TASK_STATUS_CLASSES } from "../constants";
import type { Task } from "../types";

// Icon + text, never colour alone (design board 42, "Badge trạng thái").
export function TaskStatusBadge({ task }: { task: Task }) {
  const { t } = useTranslation();
  const cancelling = task.status === "running" && task.cancelRequested;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs whitespace-nowrap",
        cancelling
          ? TASK_STATUS_CLASSES.cancelled
          : TASK_STATUS_CLASSES[task.status],
      )}
    >
      {task.status === "running" && (
        <LoaderCircle
          className="size-3 animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
      )}
      {t(
        cancelling ? "tasks.status.cancelling" : `tasks.status.${task.status}`,
      )}
    </span>
  );
}
