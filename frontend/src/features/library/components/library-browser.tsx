import {
  AudioLines,
  Check,
  Image,
  LoaderCircle,
  Search,
  Video,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LibraryFilters, LibraryItem } from "../api/library";
import type { useLibrary } from "../hooks/use-library";
import {
  LIBRARY_KINDS,
  LIBRARY_SOURCES,
  libraryItemMeta,
  libraryItemTitle,
} from "../lib/library";

const SEARCH_DEBOUNCE_MS = 300;

const KIND_ICONS = {
  video: Video,
  image: Image,
  audio: AudioLines,
} as const;

type Props = {
  selected: ReadonlySet<string>;
  onSelectedChange: (next: Set<string>, items: LibraryItem[]) => void;
  actions?: ReactNode;
  onOpen?: (item: LibraryItem) => void;
  compact?: boolean;
  library: ReturnType<typeof useLibrary>;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  notice?: ReactNode;
};

export function LibraryBrowser({
  selected,
  onSelectedChange,
  actions,
  onOpen,
  compact = false,
  library,
  filters,
  onFiltersChange,
  notice,
}: Props) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();
  const [searchInput, setSearchInput] = useState(filters.q);
  const [prevFilterQ, setPrevFilterQ] = useState(filters.q);
  if (filters.q !== prevFilterQ) {
    setPrevFilterQ(filters.q);
    if (filters.q !== searchInput.trim()) {
      setSearchInput(filters.q);
    }
  }
  const debouncedSearch = useDebouncedValue(
    searchInput.trim(),
    SEARCH_DEBOUNCE_MS,
  );

  useEffect(() => {
    if (debouncedSearch === filters.q) return;
    onFiltersChange({ ...filters, q: debouncedSearch });
  }, [debouncedSearch, filters, onFiltersChange]);

  const { query, items, total, counts } = library;
  const hasFilters =
    filters.kind !== "all" ||
    filters.source !== "all" ||
    filters.q.trim() !== "";
  const isInitialError = query.isError && !query.isFetchNextPageError;

  function toggleSelection(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedChange(next, items);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <div
          role="group"
          aria-label={t("library.filterLabel")}
          className="flex flex-wrap gap-2"
        >
          {LIBRARY_KINDS.map((kind) => {
            const active = filters.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={active}
                onClick={() => onFiltersChange({ ...filters, kind })}
                className={cn(
                  "inline-flex min-h-7.5 cursor-pointer items-center gap-1.5 rounded-full border border-input px-3 text-xs font-medium whitespace-nowrap transition-colors motion-reduce:transition-none max-tablet:min-h-11",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "text-muted-foreground hover:border-faint hover:text-foreground",
                )}
              >
                {t(`library.filters.${kind}`)}
                <span className="font-mono text-[11px] tabular-nums opacity-70">
                  {counts[kind]}
                </span>
              </button>
            );
          })}
        </div>

        <Select
          value={filters.source}
          onValueChange={(value) => {
            if (
              value === "all" ||
              value === "studio" ||
              value === "upload" ||
              value === "quick"
            ) {
              onFiltersChange({ ...filters, source: value });
            }
          }}
        >
          <SelectTrigger
            aria-label={t("library.sourceLabel")}
            className="min-w-34 data-[size=default]:h-9 data-[size=default]:max-tablet:h-11"
          >
            <SelectValue>{t(`library.sources.${filters.source}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="start">
            <SelectGroup>
              {LIBRARY_SOURCES.map((source) => (
                <SelectItem key={source} value={source}>
                  {t(`library.sources.${source}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>

        <div className="ml-auto flex w-full flex-wrap items-center gap-2 tablet:w-auto">
          <div className="relative min-w-0 flex-1 tablet:w-64">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder={t("library.searchPlaceholder")}
              aria-label={t("library.searchLabel")}
              className="h-9 pl-9 text-[13px] max-tablet:h-11"
            />
          </div>
          {actions}
        </div>
      </div>

      {notice}

      {query.isPending && <PageLoading />}

      {isInitialError && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/30 p-5"
        >
          <p className="text-sm text-destructive">{t("library.loadError")}</p>
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}

      {!query.isPending && !isInitialError && items.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center">
          {hasFilters ? (
            <Search className="size-7 text-faint" aria-hidden="true" />
          ) : (
            <Image className="size-7 text-faint" aria-hidden="true" />
          )}
          <p className="max-w-md text-sm text-muted-foreground">
            {t(hasFilters ? "library.emptyFiltered" : "library.empty")}
          </p>
        </div>
      )}

      {items.length > 0 && (
        <>
          <div
            aria-busy={query.isPlaceholderData}
            className={cn(
              "grid transition-opacity motion-reduce:transition-none",
              compact
                ? "grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-3"
                : "grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] gap-4",
              query.isPlaceholderData && "opacity-60",
            )}
          >
            {items.map((item) => {
              const isSelected = selected.has(item.id);
              const name = libraryItemTitle(item, t);
              const meta = libraryItemMeta(item, t, language, now);
              const Kind = KIND_ICONS[item.kind];

              return (
                <article
                  key={item.id}
                  className="flex min-w-0 flex-col gap-1.5"
                >
                  <div className="relative">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={isSelected}
                      aria-label={t("library.select", { name })}
                      onClick={() => toggleSelection(item.id)}
                      className={cn(
                        "absolute top-2 left-2 z-10 grid size-6 cursor-pointer place-items-center rounded-md border transition-colors motion-reduce:transition-none",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-foreground/70 bg-black/70 text-white hover:border-foreground",
                      )}
                    >
                      {isSelected && (
                        <Check className="size-3.5" aria-hidden="true" />
                      )}
                    </button>

                    <button
                      type="button"
                      aria-label={t(
                        onOpen ? "library.open" : "library.select",
                        { name },
                      )}
                      onClick={() =>
                        onOpen ? onOpen(item) : toggleSelection(item.id)
                      }
                      className={cn(
                        "relative block aspect-[4/3] w-full cursor-pointer overflow-hidden rounded-lg bg-card",
                        isSelected && "ring-2 ring-primary",
                      )}
                    >
                      {item.kind === "audio" ? (
                        <>
                          <Kind
                            className="absolute inset-0 m-auto size-6 text-faint"
                            aria-hidden="true"
                          />
                          {item.waveformUrl && (
                            <img
                              src={item.waveformUrl}
                              alt=""
                              loading="lazy"
                              onError={(event) => {
                                event.currentTarget.hidden = true;
                              }}
                              className="absolute inset-x-2 inset-y-3 h-[calc(100%-1.5rem)] w-[calc(100%-1rem)] bg-card object-contain opacity-75"
                            />
                          )}
                        </>
                      ) : item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt=""
                          loading="lazy"
                          className="absolute inset-0 size-full object-cover"
                        />
                      ) : (
                        <Kind
                          className="absolute inset-0 m-auto size-6 text-faint"
                          aria-hidden="true"
                        />
                      )}

                      <span className="absolute top-1.5 right-1.5 grid size-5.5 place-items-center rounded bg-black/70 text-white">
                        <Kind className="size-3.5" aria-hidden="true" />
                      </span>

                      {item.seconds !== null && (
                        <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[11px] leading-none font-medium text-white tabular-nums">
                          {formatDuration(Math.round(item.seconds))}
                        </span>
                      )}
                    </button>
                  </div>

                  <p className="truncate text-[13px] font-medium" title={name}>
                    {name}
                  </p>
                  <p className="truncate text-xs text-faint">{meta}</p>
                </article>
              );
            })}
          </div>

          {query.hasNextPage && (
            <div className="flex flex-col items-center gap-3 pt-2 text-center">
              <p aria-live="polite" className="text-xs text-faint">
                {t("library.showing", { shown: items.length, total })}
              </p>
              {query.isFetchNextPageError && (
                <p role="alert" className="text-sm text-destructive">
                  {t("library.loadError")}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
                className="min-w-40"
              >
                {query.isFetchingNextPage && (
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                )}
                {t(
                  query.isFetchingNextPage
                    ? "common.loading"
                    : query.isFetchNextPageError
                      ? "common.retry"
                      : "library.loadMore",
                )}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
