import { Tooltip } from "radix-ui";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useMatch } from "react-router";

import {
  navigationGroups,
  settingsNavigation,
  type NavigationItem,
} from "@/app/navigation";
import { useTaskSummary } from "@/features/tasks/hooks/use-task-queries";
import { cn } from "@/lib/utils";

type NavigationProps = {
  /** Icon rail: labels move into tooltips. */
  compact?: boolean;
};

function NavigationLink({
  item,
  compact = false,
  badge = 0,
}: NavigationProps & { item: NavigationItem; badge?: number }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(`pages.${item.id}.title`);
  // Resolve the active state here and pass plain strings: Radix Slot
  // (Tooltip.Trigger asChild) stringifies function classNames.
  const isActive = useMatch({ path: item.path, end: false }) !== null;

  const link = (
    <NavLink
      to={item.path}
      aria-label={compact ? label : undefined}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium whitespace-nowrap transition-colors motion-reduce:transition-none",
        compact && "relative h-10 w-11 justify-center px-0",
        isActive
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon
        className={cn("size-4 shrink-0", isActive && "text-primary")}
        aria-hidden="true"
      />
      {!compact && <span>{label}</span>}
      {badge > 0 &&
        (compact ? (
          // Rail: a dot; the tooltip and screen-reader text carry the count.
          <span
            className="absolute top-2 right-2.5 size-1.5 rounded-full bg-destructive"
            aria-hidden="true"
          />
        ) : (
          <span
            className="ml-auto grid h-5 min-w-5 place-items-center rounded-full bg-destructive-soft px-1.5 text-[11px] font-semibold text-destructive"
            aria-hidden="true"
          >
            {badge}
          </span>
        ))}
      {badge > 0 && (
        <span className="sr-only">{t("tasks.badge", { count: badge })}</span>
      )}
    </NavLink>
  );

  if (!compact) return link;

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{link}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={10}
          className="z-50 rounded-md border border-input bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function AppNavigation({ compact = false }: NavigationProps) {
  const { t } = useTranslation();
  // Design board 42: the Tasks item shows how many tasks need a decision.
  const summary = useTaskSummary();
  const attention = summary.data?.attention ?? 0;

  return (
    <nav
      aria-label={t("navigation.main")}
      className={cn("flex min-h-0 flex-1 flex-col", compact && "items-center")}
    >
      <div
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto",
          compact && "items-center",
        )}
      >
        {navigationGroups.map((group, index) => (
          <Fragment key={group.id}>
            {compact && index > 0 && (
              <div aria-hidden="true" className="my-2.5 h-px w-7 shrink-0 bg-border" />
            )}
            <p
              className={cn(
                "px-2.5 pt-4.5 pb-2 text-[11px] leading-none font-semibold tracking-[0.07em] text-faint uppercase",
                compact && "sr-only",
              )}
            >
              {t(`navigation.groups.${group.id}`)}
            </p>
            <div className={cn("flex flex-col gap-0.5", compact && "items-center")}>
              {group.items.map((item) => (
                <NavigationLink
                  key={item.path}
                  item={item}
                  compact={compact}
                  badge={item.id === "tasks" ? attention : 0}
                />
              ))}
            </div>
          </Fragment>
        ))}
      </div>
      <div className={cn("mt-auto flex flex-col gap-1 pt-4", compact && "items-center")}>
        <NavigationLink item={settingsNavigation} compact={compact} />
      </div>
    </nav>
  );
}
