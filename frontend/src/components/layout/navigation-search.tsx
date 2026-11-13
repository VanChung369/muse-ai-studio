import { ArrowRight, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { navigationItems } from "@/app/navigation";
import { Button } from "@/components/ui/button";
import { isApplePlatform } from "@/lib/platform";
import { normalizeSearchText } from "@/lib/string";

const shortcutLabel = isApplePlatform() ? "⌘ K" : "Ctrl K";

export function NavigationSearch({
  onBeforeOpen,
}: {
  /** Called before the dialog opens, e.g. to close another modal. */
  onBeforeOpen?: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigatedFromSearch = useRef(false);
  const navigate = useNavigate();
  const normalizedQuery = normalizeSearchText(query.trim());
  const matches = navigationItems.filter((item) =>
    normalizeSearchText(t(`pages.${item.id}.title`)).includes(normalizedQuery),
  );

  function onOpenChange(next: boolean) {
    if (next) onBeforeOpen?.();
    setOpen(next);
    if (!next) setQuery("");
  }

  function goTo(path: string) {
    navigatedFromSearch.current = true;
    navigate(path);
    onOpenChange(false);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Autofill can dispatch keydown events without a key.
      if (event.isComposing || !event.key) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={t("search.triggerLabel")}
          className="flex h-9 min-w-0 flex-1 items-center gap-2.5 rounded-lg border bg-card pr-2.5 pl-3 text-left text-faint transition-colors hover:border-input hover:text-muted-foreground tablet:max-w-[420px] tablet:min-w-[200px]"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate">{t("search.trigger")}</span>
          <kbd className="hidden rounded-xs border border-input bg-secondary px-1.5 py-[3px] font-mono text-[11px] leading-none font-medium text-muted-foreground tablet:inline">
            {shortcutLabel}
          </kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgb(6_6_8/0.62)]" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            // Route changes move focus to <main>; don't pull it back here.
            if (navigatedFromSearch.current) event.preventDefault();
            navigatedFromSearch.current = false;
          }}
          className="fixed top-[12vh] left-1/2 z-50 flex max-h-[75svh] w-[calc(100%-2rem)] max-w-[500px] -translate-x-1/2 flex-col overflow-hidden rounded-[14px] border border-input bg-popover shadow-[0_24px_64px_rgb(0_0_0/0.55)]"
        >
          <Dialog.Title className="sr-only">{t("search.title")}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("search.description")}
          </Dialog.Description>
          <div className="flex items-center gap-3 border-b py-2 pr-2 pl-4">
            <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
            <input
              aria-label={t("search.inputLabel")}
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                // Enter also confirms IME composition (e.g. Vietnamese Telex).
                if (event.nativeEvent.isComposing || event.keyCode === 229)
                  return;
                if (event.key === "Enter" && matches[0]) {
                  event.preventDefault();
                  goTo(matches[0].path);
                }
              }}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
            />
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("search.close")}
              >
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <nav
            aria-label={t("search.resultsLabel")}
            className="overflow-y-auto p-1.5"
          >
            {matches.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => {
                  navigatedFromSearch.current = true;
                  onOpenChange(false);
                }}
                className="group flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-sm text-foreground hover:bg-accent max-tablet:min-h-11"
              >
                <item.icon
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                <span className="flex-1">{t(`pages.${item.id}.title`)}</span>
                <ArrowRight
                  className="size-3.5 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
              </Link>
            ))}
            {matches.length === 0 && (
              <p
                role="status"
                className="px-4 py-10 text-center text-sm text-muted-foreground"
              >
                {t("search.noResults")}
              </p>
            )}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
