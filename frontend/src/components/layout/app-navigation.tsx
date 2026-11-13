import { Tooltip } from "radix-ui";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";

import {
  navigationGroups,
  settingsNavigation,
  type NavigationItem,
} from "@/app/navigation";
import { cn } from "@/lib/utils";

type NavigationProps = {
  compact?: boolean;
  responsive?: boolean;
  onNavigate?: () => void;
};

function NavigationLink({
  item,
  compact,
  responsive,
  onNavigate,
}: NavigationProps & { item: NavigationItem }) {
  const { t } = useTranslation();
  const Icon = item.icon;
  const label = t(`pages.${item.id}.title`);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <NavLink
          to={item.path}
          aria-label={label}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              "group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors motion-reduce:transition-none",
              compact
                ? "justify-center px-0"
                : responsive && "justify-center px-0 xl:justify-start xl:px-3",
              isActive
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon
                className={cn("size-4 shrink-0", isActive && "text-primary")}
                aria-hidden="true"
              />
              {!compact && (
                <span
                  className={cn(
                    "whitespace-nowrap",
                    responsive && "hidden xl:inline",
                  )}
                >
                  {label}
                </span>
              )}
            </>
          )}
        </NavLink>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          sideOffset={12}
          className="z-50 rounded-md border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function AppNavigation({
  compact = false,
  responsive = false,
  onNavigate,
}: NavigationProps) {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("navigation.main")} className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto py-6">
        {navigationGroups.map((group) => (
          <div key={group.id}>
            <p
              className={cn(
                "mb-2 px-3 text-[10px] font-medium tracking-[0.09em] text-muted-foreground uppercase",
                compact
                  ? "sr-only"
                  : responsive &&
                      "sr-only xl:not-sr-only xl:mb-2 xl:px-3 xl:text-[10px]",
              )}
            >
              {t(`navigation.groups.${group.id}`)}
            </p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavigationLink
                  key={item.path}
                  item={item}
                  compact={compact}
                  responsive={responsive}
                  onNavigate={onNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="border-t pt-3 pb-1">
        <NavigationLink
          item={settingsNavigation}
          compact={compact}
          responsive={responsive}
          onNavigate={onNavigate}
        />
      </div>
    </nav>
  );
}
