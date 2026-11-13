import { Check, Clapperboard, Plus, Search } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { PageLoading } from "@/components/shared/page-loading";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { FeaturedProject } from "@/features/projects/components/featured-project";
import { NewProjectDialog } from "@/features/projects/components/new-project-dialog";
import { ProjectCard } from "@/features/projects/components/project-card";
import { ProjectDetailsSheet } from "@/features/projects/components/project-details-sheet";
import { ProjectListFooter } from "@/features/projects/components/project-list-footer";
import { ProjectToolbar } from "@/features/projects/components/project-toolbar";
import { useProjectList } from "@/features/projects/hooks/use-project-list";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/utils";

export function ProjectsPage() {
  const { t } = useTranslation();
  const list = useProjectList();
  useDocumentTitle(t("pages.projects.title"));
  const gridRef = useRef<HTMLDivElement>(null);
  // Index of the first card a "Load more" request will add. The button can
  // disappear after the last page, so focus moves to the new cards instead.
  const firstNewCard = useRef<number | null>(null);

  useEffect(() => {
    const index = firstNewCard.current;
    if (index === null || list.isLoadingMore) return;
    firstNewCard.current = null;
    gridRef.current
      ?.querySelectorAll<HTMLElement>("[data-project-id]")
      [index]?.focus();
  }, [list.projects.length, list.isLoadingMore]);

  function loadMore() {
    firstNewCard.current = list.projects.length;
    list.loadMore();
  }

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.projects.title")}
        description={t("pages.projects.description")}
        actions={
          <NewProjectDialog
            open={list.createOpen}
            onOpenChange={list.setCreateOpen}
            onCreate={list.createDraft}
            hasError={list.createError}
          />
        }
      />
      {list.lastCreated && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {t("projects.form.saved", { name: list.lastCreated.name })}
        </p>
      )}
      {list.lastDeleted && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {t("projects.delete.deleted", { name: list.lastDeleted })}
        </p>
      )}
      {list.isLoading && <PageLoading />}
      {list.isError && (
        <div
          role="alert"
          className="mb-5 space-y-3 rounded-xl border border-destructive/30 p-5"
        >
          <p className="text-sm text-muted-foreground">
            {t("projects.loadError")}
          </p>
          <Button
            variant="outline"
            disabled={list.isFetching}
            onClick={list.retryProjects}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {list.hasData && (
        <>
          {list.featuredProject && (
            <FeaturedProject
              project={list.featuredProject}
              onOpen={list.selectProject}
            />
          )}
          <ProjectToolbar
            query={list.query}
            filter={list.filter}
            sort={list.sort}
            counts={list.counts}
            onQueryChange={list.setQuery}
            onFilterChange={list.setFilter}
            onSortChange={list.setSort}
          />
          {list.projects.length > 0 ? (
            <>
              <div
                ref={gridRef}
                aria-busy={list.isUpdating}
                className={cn(
                  "grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4 transition-opacity motion-reduce:transition-none",
                  list.isUpdating && "opacity-60",
                )}
                data-slot="project-grid"
              >
                {list.projects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    onOpen={list.selectProject}
                    onDeleted={list.projectDeleted}
                  />
                ))}
              </div>
              <ProjectListFooter
                shown={list.projects.length}
                total={list.total}
                hasMore={list.hasMore}
                isLoadingMore={list.isLoadingMore}
                hasError={list.loadMoreError}
                onLoadMore={loadMore}
              />
            </>
          ) : (
            <section className="flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center">
              {list.counts.all === 0 ? (
                <Clapperboard
                  className="size-7 text-faint"
                  aria-hidden="true"
                />
              ) : (
                <Search className="size-7 text-faint" aria-hidden="true" />
              )}
              <h3 className="text-base font-semibold">
                {t(
                  list.counts.all === 0
                    ? "projects.empty.title"
                    : "projects.empty.noResults",
                )}
              </h3>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                {t(
                  list.counts.all === 0
                    ? "projects.empty.description"
                    : "projects.empty.noResultsDescription",
                )}
              </p>
              {list.counts.all === 0 ? (
                <Button onClick={() => list.setCreateOpen(true)}>
                  <Plus aria-hidden="true" />
                  {t("projects.newProject")}
                </Button>
              ) : (
                <Button variant="outline" onClick={list.clearFilters}>
                  {t("projects.empty.clear")}
                </Button>
              )}
            </section>
          )}
        </>
      )}
      <ProjectDetailsSheet
        open={Boolean(list.selectedId)}
        project={list.selectedProject}
        isLoading={list.detailLoading}
        isMissing={list.detailMissing}
        isError={list.detailError}
        isFetching={list.detailFetching}
        onRetry={list.retryProject}
        onClose={list.closeProject}
        onDeleted={list.projectDeleted}
        onCloseAutoFocus={list.restoreProjectFocus}
      />
    </div>
  );
}
