import {
  Activity,
  ChevronRight,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { Dialog, Tooltip } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router";

import { navigationGroups, navigationItems } from "@/app/navigation";
import { AppNavigation } from "@/components/layout/app-navigation";
import { Brand } from "@/components/layout/brand";
import { NavigationSearch } from "@/components/layout/navigation-search";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { STORAGE_KEYS } from "@/constants/storage";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";

export function AppLayout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useLocalStorage(
    STORAGE_KEYS.SIDEBAR_COLLAPSED,
    false,
  );
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const previousPath = useRef(location.pathname);
  const mainRef = useRef<HTMLElement>(null);
  const page = navigationItems.find((item) => item.path === location.pathname);
  const group = navigationGroups.find((item) =>
    item.items.some((entry) => entry.path === location.pathname),
  );
  const pageTitle = page ? t(`pages.${page.id}.title`) : t("notFound.title");

  useEffect(() => {
    document.title = t("app.documentTitle", { title: pageTitle, appName: t("app.name") });
    if (previousPath.current !== location.pathname) {
      mainRef.current?.scrollTo({ top: 0 });
      mainRef.current?.focus();
      previousPath.current = location.pathname;
    }
  }, [location.pathname, pageTitle, t]);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 768px)");
    function onResize(event: MediaQueryListEvent) {
      if (event.matches) setMobileOpen(false);
    }
    media.addEventListener("change", onResize);
    return () => media.removeEventListener("change", onResize);
  }, []);

  function toggleSidebar() {
    setCollapsed((previous) => !previous);
  }

  return (
    <Tooltip.Provider delayDuration={400}>
      <div className="flex h-svh overflow-hidden bg-background text-foreground">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-md bg-primary px-4 py-3 text-sm text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          {t("navigation.skipToContent")}
        </a>

        <aside
          aria-label={t("navigation.sidebar")}
          className={cn(
            "hidden shrink-0 flex-col border-r bg-sidebar p-3 md:flex",
            collapsed ? "w-16" : "w-16 xl:w-58",
          )}
        >
          <Brand compact={collapsed} responsive />
          <AppNavigation compact={collapsed} responsive />
          <Button
            variant="ghost"
            onClick={toggleSidebar}
            aria-label={t(collapsed ? "navigation.expandSidebar" : "navigation.collapseSidebar")}
            title={t(collapsed ? "navigation.expandSidebar" : "navigation.collapseSidebar")}
            className={cn(
              "mt-2 hidden h-9 text-muted-foreground xl:flex",
              collapsed ? "px-0" : "justify-start px-3",
            )}
          >
            {collapsed ? (
              <PanelLeftOpen aria-hidden="true" />
            ) : (
              <>
                <PanelLeftClose aria-hidden="true" />
                <span className="text-xs">{t("navigation.collapseSidebar")}</span>
              </>
            )}
          </Button>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 shrink-0 items-center gap-3 border-b px-4 sm:px-6 lg:px-8">
            <Dialog.Root open={mobileOpen} onOpenChange={setMobileOpen}>
              <Dialog.Trigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("navigation.openMenu")}
                  className="size-11 shrink-0 md:hidden"
                >
                  <Menu aria-hidden="true" />
                </Button>
              </Dialog.Trigger>
              <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65" />
                <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,calc(100%-3rem))] flex-col border-r bg-sidebar p-4 shadow-2xl">
                  <Dialog.Title className="sr-only">
                    {t("navigation.menuTitle", { appName: t("app.name") })}
                  </Dialog.Title>
                  <Dialog.Description className="sr-only">
                    {t("navigation.menuDescription")}
                  </Dialog.Description>
                  <div className="flex items-center justify-between">
                    <div onClick={() => setMobileOpen(false)}>
                      <Brand />
                    </div>
                    <Dialog.Close asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("navigation.closeMenu")}
                      >
                        <X aria-hidden="true" />
                      </Button>
                    </Dialog.Close>
                  </div>
                  <AppNavigation onNavigate={() => setMobileOpen(false)} />
                </Dialog.Content>
              </Dialog.Portal>
            </Dialog.Root>

            <div
              aria-label={t("navigation.currentLocation")}
              className="flex min-w-0 flex-1 items-center gap-2 text-xs"
            >
              <span className="hidden text-muted-foreground lg:inline">
                {group ? t(`navigation.groups.${group.id}`) : t("app.name")}
              </span>
              <ChevronRight
                className="hidden size-3.5 text-muted-foreground lg:block"
                aria-hidden="true"
              />
              <span className="truncate font-medium">
                {pageTitle}
              </span>
            </div>
            <NavigationSearch />
            <LanguageSwitcher />
            <Link
              to={ROUTES.TASKS}
              className="hidden h-9 items-center gap-2 rounded-full border px-3 text-xs text-muted-foreground hover:bg-accent hover:text-foreground sm:flex"
            >
              <Activity className="size-3.5" aria-hidden="true" />
              {t("pages.tasks.title")}
            </Link>
          </header>

          <main
            ref={mainRef}
            id="main-content"
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto outline-none"
          >
            <Outlet />
          </main>
        </div>
      </div>
    </Tooltip.Provider>
  );
}
