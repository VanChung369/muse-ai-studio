import { Ellipsis } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router";

import {
  mobileMoreNavigation,
  mobilePrimaryNavigation,
} from "@/app/navigation";
import { cn } from "@/lib/utils";

const tabClassName =
  "flex h-13 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] leading-none font-medium";

// Phone navigation (< 820px), board 41 in the design.
export function MobileTabBar({
  moreOpen,
  onMoreOpenChange,
}: {
  moreOpen: boolean;
  onMoreOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigatedFromSheet = useRef(false);
  const moreActive = mobileMoreNavigation.some(
    (item) => item.path === location.pathname,
  );

  return (
    <nav
      aria-label={t("navigation.main")}
      className="grid shrink-0 grid-cols-5 border-t bg-card px-1 pt-1.5 pb-[calc(10px+env(safe-area-inset-bottom))] tablet:hidden"
    >
      {mobilePrimaryNavigation.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          className={({ isActive }) =>
            cn(tabClassName, isActive ? "text-foreground" : "text-faint")
          }
        >
          {({ isActive }) => (
            <>
              <item.icon
                className={cn("size-5", isActive && "text-primary")}
                aria-hidden="true"
              />
              <span className="max-w-full truncate">
                {t(`pages.${item.id}.title`)}
              </span>
            </>
          )}
        </NavLink>
      ))}

      <Dialog.Root open={moreOpen} onOpenChange={onMoreOpenChange}>
        <Dialog.Trigger
          className={cn(
            tabClassName,
            moreActive || moreOpen ? "text-foreground" : "text-faint",
          )}
        >
          <Ellipsis
            className={cn("size-5", moreActive && "text-primary")}
            aria-hidden="true"
          />
          {t("navigation.more")}
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(6_6_8/0.62)]" />
          <Dialog.Content
            onCloseAutoFocus={(event) => {
              // Route changes move focus to <main>; don't pull it back here.
              if (navigatedFromSheet.current) event.preventDefault();
              navigatedFromSheet.current = false;
            }}
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[80svh] flex-col rounded-t-2xl border-t border-input bg-card pb-[calc(12px+env(safe-area-inset-bottom))] shadow-[0_-20px_50px_rgb(0_0_0/0.5)]"
          >
            <div
              aria-hidden="true"
              className="mx-auto mt-2.5 mb-1 h-1 w-10 rounded-full bg-surface-4"
            />
            <Dialog.Title className="px-5 pt-2 pb-1 text-[15px] leading-5.5 font-semibold">
              {t("navigation.moreTitle")}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              {t("navigation.moreDescription")}
            </Dialog.Description>
            <div className="flex flex-col overflow-y-auto px-2 pt-1">
              {mobileMoreNavigation.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={() => {
                    navigatedFromSheet.current = true;
                    onMoreOpenChange(false);
                  }}
                  className={({ isActive }) =>
                    cn(
                      "flex h-11 items-center gap-3 rounded-lg px-3 text-sm font-medium",
                      isActive
                        ? "bg-accent text-foreground"
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn("size-4.5", isActive && "text-primary")}
                        aria-hidden="true"
                      />
                      {t(`pages.${item.id}.title`)}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </nav>
  );
}
