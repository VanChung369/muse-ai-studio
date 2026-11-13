import {
  Ban,
  Check,
  CircleAlert,
  FileText,
  LoaderCircle,
  Pencil,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { ProjectStatus } from "../types";

const presentation = {
  draft: { icon: FileText, className: "bg-accent/70 text-muted-foreground" },
  planning: { icon: LoaderCircle, className: "bg-running-soft text-running" },
  ready: { icon: Pencil, className: "bg-primary-soft text-primary" },
  rendering: { icon: LoaderCircle, className: "bg-running-soft text-running" },
  cancelling: { icon: LoaderCircle, className: "bg-warning-soft text-warning" },
  cancelled: { icon: Ban, className: "border border-input text-faint" },
  failed: {
    icon: CircleAlert,
    className: "bg-destructive-soft text-destructive",
  },
  completed: { icon: Check, className: "bg-success-soft text-success" },
} as const;

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation();
  const style = presentation[status];
  const Icon = style.icon;
  const running =
    status === "planning" || status === "rendering" || status === "cancelling";

  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] leading-none font-medium whitespace-nowrap",
        style.className,
      )}
    >
      <Icon
        className={cn(
          "size-3",
          running && "animate-spin motion-reduce:animate-none",
        )}
        aria-hidden="true"
      />
      {t(`projects.status.${status}`)}
    </span>
  );
}
