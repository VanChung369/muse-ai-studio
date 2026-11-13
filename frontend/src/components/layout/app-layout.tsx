import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "radix-ui";
import { Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  NavigationType,
  Outlet,
  useLocation,
  useNavigationType,
} from "react-router";

import { AppNavigation } from "@/components/layout/app-navigation";
import { Brand } from "@/components/layout/brand";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { MobileTabBar } from "@/components/layout/mobile-tab-bar";
import { NavigationSearch } from "@/components/layout/navigation-search";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { MEDIA_QUERIES } from "@/constants/breakpoints";
import { TaskIndicator } from "@/features/tasks/components/task-indicator";
import { STORAGE_KEYS } from "@/constants/storage";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { useMediaQuery } from "@/hooks/use-media-query";
import { cn } from "@/lib/utils";

// Breakpoints follow design board 41:
// >= 1180 full sidebar (232px), 820-1179 icon rail (64px), < 820 bottom tab bar.
export function AppLayout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useLocalStorage(
    STORAGE_KEYS.SIDEBAR_COLLAPSED,
    false,
  );
  const isTablet = useMediaQuery(MEDIA_QUERIES.TABLET);
  const isDesktop = useMediaQuery(MEDIA_QUERIES.DESKTOP);
  const rail = collapsed || !isDesktop;
  const [moreOpen, setMoreOpen] = useState(false);
  const location = useLocation();
  const navigationType = useNavigationType();
  const previousPath = useRef(location.pathname);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (previousPath.current === location.pathname) return;
    previousPath.current = location.pathname;
    mainRef.current?.scrollTo({ top: 0 });
    // Redirects (e.g. "/" -> "/projects") are not user navigation; keep the
    // skip link reachable on first load.
    if (navigationType !== NavigationType.Replace) {
      mainRef.current?.focus({ preventScroll: true });
    }
  }, [location.pathname, navigationType]);

  const collapseLabel = t(
    collapsed ? "navigation.expandSidebar" : "navigation.collapseSidebar",
  );

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          {t("navigation.skipToContent")}
        </a>

        {/* Unmounted on phones so open rail tooltips don't linger. */}
        {isTablet && (
          <aside
            aria-label={t("navigation.sidebar")}
            className={cn(
              "flex shrink-0 flex-col gap-0.5 border-r bg-sidebar",
              rail ? "w-16 items-center px-2 py-3.5" : "w-58 px-3 py-3.5",
            )}
          >
            <Brand
              compact={rail}
              className={rail ? "pt-1 pb-3.5" : "px-2 pt-1 pb-3.5"}
            />
            <AppNavigation compact={rail} />
            {isDesktop && (
              <Button
                variant="ghost"
                size={rail ? "icon" : "default"}
                onClick={() => setCollapsed((previous) => !previous)}
                aria-label={collapseLabel}
                title={collapseLabel}
                className={cn(
                  "mt-1 shrink-0 text-faint",
                  rail ? "h-10 w-11" : "justify-start px-2.5 text-[13px]",
                )}
              >
                {collapsed ? (
                  <PanelLeftOpen aria-hidden="true" />
                ) : (
                  <>
                    <PanelLeftClose aria-hidden="true" />
                    {!rail && <span>{collapseLabel}</span>}
                  </>
                )}
              </Button>
            )}
          </aside>
        )}

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 py-2.5 tablet:px-8">
            <Brand compact className="tablet:hidden" />
            <NavigationSearch onBeforeOpen={() => setMoreOpen(false)} />
            <div className="ml-auto flex shrink-0 items-center gap-2.5">
              <LanguageSwitcher />
              <TaskIndicator />
            </div>
          </header>

          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            // Positioned, so visually hidden (absolute) content inside a page
            // scrolls with it instead of stretching the document.
            className="relative min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </main>

          <MobileTabBar
            moreOpen={moreOpen && !isTablet}
            onMoreOpenChange={setMoreOpen}
          />
        </div>
      </div>
    </Tooltip.Provider>
  );
}
