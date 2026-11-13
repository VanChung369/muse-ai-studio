import {
  Ban,
  Check,
  CircleAlert,
  CircleDashed,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";
import type { AccountStatus } from "../types";

const presentation = {
  ready: { icon: Check, className: "bg-success-soft text-success" },
  lowQuota: { icon: TriangleAlert, className: "bg-warning-soft text-warning" },
  expired: {
    icon: CircleAlert,
    className: "bg-destructive-soft text-destructive",
  },
  proxyError: {
    icon: CircleAlert,
    className: "bg-destructive-soft text-destructive",
  },
  paused: { icon: Ban, className: "text-faint ring-1 ring-input ring-inset" },
  unverified: {
    icon: CircleDashed,
    className: "bg-accent/70 text-muted-foreground",
  },
} as const;

// Icon + text, never colour alone (design board 42, "Badge trạng thái").
export function AccountStatusBadge({ status }: { status: AccountStatus }) {
  const { t } = useTranslation();
  const style = presentation[status];
  const Icon = style.icon;

  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs leading-none font-medium whitespace-nowrap",
        style.className,
      )}
    >
      <Icon className="size-3.25 shrink-0" aria-hidden="true" />
      {t(`accounts.status.${status}`)}
    </span>
  );
}
