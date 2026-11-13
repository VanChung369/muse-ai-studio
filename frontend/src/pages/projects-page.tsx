import { Check, Clapperboard, Plus, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { FeaturedProject } from "@/features/projects/components/featured-project";
import { NewProjectDialog } from "@/features/projects/components/new-project-dialog";
import { ProjectCard } from "@/features/projects/components/project-card";
import { ProjectDetailsSheet } from "@/features/projects/components/project-details-sheet";
import { ProjectToolbar } from "@/features/projects/components/project-toolbar";
import { useProjectList } from "@/features/projects/hooks/use-project-list";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function ProjectsPage() {
  const { t } = useTranslation();
  const list = useProjectList();
  useDocumentTitle(t("pages.projects.title"));

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
          />
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded-md border border-dashed border-input px-2 py-1 text-[10px] tracking-wide text-faint">
          {t("projects.demoBadge")}
        </span>
        <p className="text-xs text-faint">{t("projects.demoDescription")}</p>
      </div>
      {list.lastCreated && (
        <p
          role="status"
          className="mb-4 flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {t("projects.form.saved", { name: list.lastCreated.name })}
        </p>
      )}
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
      {list.visibleProjects.length > 0 ? (
        <div
          className="grid grid-cols-[repeat(auto-fill,minmax(min(280px,100%),1fr))] gap-4"
          data-slot="project-grid"
        >
          {list.visibleProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={list.selectProject}
            />
          ))}
        </div>
      ) : (
        <section className="flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center">
          {list.projects.length === 0 ? (
            <Clapperboard className="size-7 text-faint" aria-hidden="true" />
          ) : (
            <Search className="size-7 text-faint" aria-hidden="true" />
          )}
          <h3 className="text-base font-semibold">
            {t(
              list.projects.length === 0
                ? "projects.empty.title"
                : "projects.empty.noResults",
            )}
          </h3>
          <p className="max-w-sm text-sm leading-6 text-muted-foreground">
            {t(
              list.projects.length === 0
                ? "projects.empty.description"
                : "projects.empty.noResultsDescription",
            )}
          </p>
          {list.projects.length === 0 ? (
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
      <ProjectDetailsSheet
        open={Boolean(list.selectedId)}
        project={list.selectedProject}
        onClose={list.closeProject}
        onCloseAutoFocus={list.restoreProjectFocus}
      />
    </div>
  );
}
