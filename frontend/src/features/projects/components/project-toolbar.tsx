import { Search } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PROJECT_FILTERS, PROJECT_SORTS } from "../constants";
import { resolveProjectSort } from "../lib/project-list";
import type { ProjectFilter, ProjectSort } from "../types";

type Props = {
  query: string;
  filter: ProjectFilter;
  sort: ProjectSort;
  counts: Record<ProjectFilter, number>;
  onQueryChange: (value: string) => void;
  onFilterChange: (value: ProjectFilter) => void;
  onSortChange: (value: ProjectSort) => void;
};

export function ProjectToolbar({
  query,
  filter,
  sort,
  counts,
  onQueryChange,
  onFilterChange,
  onSortChange,
}: Props) {
  const { t } = useTranslation();
  const searchId = useId();

  return (
    <div className="mt-8 mb-4 flex flex-wrap items-center gap-3">
      <h2 className="mr-2 text-lg font-semibold">
        {t("projects.allProjects")}
      </h2>
      <div
        role="group"
        aria-label={t("projects.filterLabel")}
        className="flex flex-wrap gap-2"
      >
        {PROJECT_FILTERS.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={filter === option}
            onClick={() => onFilterChange(option)}
            className={cn(
              "inline-flex min-h-7.5 cursor-pointer items-center gap-1.5 rounded-full border border-input px-3 text-xs whitespace-nowrap transition-colors hover:text-foreground max-tablet:min-h-11",
              filter === option
                ? "border-foreground bg-foreground text-background"
                : "text-muted-foreground hover:border-faint",
            )}
          >
            {t(`projects.filters.${option}`)}
            <span className="font-mono text-[11px] opacity-65">
              {counts[option]}
            </span>
          </button>
        ))}
      </div>
      <div className="ml-auto flex w-full flex-wrap gap-2 tablet:w-auto">
        <div className="relative min-w-0 flex-1 tablet:w-60">
          <Label htmlFor={searchId} className="sr-only">
            {t("projects.searchLabel")}
          </Label>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
          <Input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder={t("projects.searchPlaceholder")}
            className="h-9 pl-9 text-[13px] max-tablet:h-11"
          />
        </div>
        <Select
          value={sort}
          onValueChange={(value) => onSortChange(resolveProjectSort(value))}
        >
          <SelectTrigger
            aria-label={t("projects.sortLabel")}
            className="min-w-36 bg-secondary data-[size=default]:h-9 data-[size=default]:max-tablet:h-11"
          >
            <SelectValue>{t(`projects.sorts.${sort}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="end">
            <SelectGroup>
              {PROJECT_SORTS.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`projects.sorts.${option}`)}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
