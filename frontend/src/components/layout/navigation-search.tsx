import { ArrowRight, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";

import { navigationItems } from "@/app/navigation";
import { Button } from "@/components/ui/button";
import { normalizeSearchText } from "@/lib/string";

export function NavigationSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const normalizedQuery = normalizeSearchText(query.trim());
  const matches = navigationItems.filter((item) =>
    normalizeSearchText(t(`pages.${item.id}.title`)).includes(normalizedQuery),
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setQuery("");
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label={t("search.triggerLabel")}
          className="flex h-9 w-9 items-center justify-center gap-2.5 rounded-lg border bg-card text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground sm:w-64 sm:justify-start sm:px-3"
        >
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <span className="hidden flex-1 text-left text-xs sm:inline">
            {t("search.trigger")}
          </span>
          <kbd className="hidden rounded border px-1.5 py-0.5 font-mono text-[10px] sm:inline">
            {t("search.shortcut")}
          </kbd>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/65" />
        <Dialog.Content className="fixed top-[12vh] left-1/2 z-50 flex max-h-[75svh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 flex-col overflow-hidden rounded-xl border bg-popover shadow-2xl">
          <Dialog.Title className="sr-only">{t("search.title")}</Dialog.Title>
          <Dialog.Description className="sr-only">
            {t("search.description")}
          </Dialog.Description>
          <div className="flex items-center gap-3 border-b px-4 py-3">
            <Search
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <input
              aria-label={t("search.inputLabel")}
              placeholder={t("search.placeholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && matches[0]) {
                  event.preventDefault();
                  navigate(matches[0].path);
                  onOpenChange(false);
                }
              }}
              className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <Dialog.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t("search.close")}>
                <X aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          <nav aria-label={t("search.resultsLabel")} className="overflow-y-auto p-2">
            {matches.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => onOpenChange(false)}
                className="group flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <item.icon className="size-4 shrink-0" aria-hidden="true" />
                <span className="flex-1">{t(`pages.${item.id}.title`)}</span>
                <ArrowRight
                  className="size-3.5 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
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
