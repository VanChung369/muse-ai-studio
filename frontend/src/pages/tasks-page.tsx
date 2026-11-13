import { Activity, AlertTriangle, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import { TaskDetailsSheet } from "@/features/tasks/components/task-details-sheet";
import { TaskRow } from "@/features/tasks/components/task-row";
import { TASK_FILTERS } from "@/features/tasks/constants";
import { useTaskList } from "@/features/tasks/hooks/use-task-list";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function TasksPage() {
  const { t } = useTranslation();
  const list = useTaskList();
  const query = list.query;
  const firstPage = query.data?.pages[0];
  const counts = firstPage?.counts;
  useDocumentTitle(t("pages.tasks.title"));

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.tasks.title")}
        description={t("pages.tasks.description")}
        actions={
          <Button
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw
              className={
                query.isFetching
                  ? "animate-spin motion-reduce:animate-none"
                  : undefined
              }
              aria-hidden="true"
            />
            {t("tasks.refresh")}
          </Button>
        }
      />
      {list.projectId && (
        <div className="mb-5 flex flex-wrap items-center gap-2 rounded-lg border p-3 text-sm">
          <span className="min-w-0 flex-1 wrap-break-word">
            {t("tasks.projectFilter", { id: list.projectId })}
          </span>
          <ActionBar>
            <Button variant="ghost" size="sm" onClick={list.clearProject}>
              <X aria-hidden="true" />
              {t("tasks.clearProject")}
            </Button>
          </ActionBar>
        </div>
      )}
      {counts && (
        <dl className="mb-6 grid grid-cols-3 gap-3">
          {(["running", "queued", "attention"] as const).map((filter) => (
            <div
              key={filter}
              className="rounded-xl border bg-card p-3 tablet:p-4"
            >
              <dt className="text-xs text-faint">
                {t(`tasks.filters.${filter}`)}
              </dt>
              <dd className="mt-2 font-mono text-2xl font-semibold">
                {counts[filter]}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {counts && counts.attention > 0 && list.filter !== "attention" && (
        <section className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive-soft p-4">
          <AlertTriangle
            className="size-5 text-destructive"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold">
              {t("tasks.attentionCount", { count: counts.attention })}
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t("tasks.attentionDescription")}
            </p>
          </div>
          <ActionBar className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => list.setFilter("attention")}
            >
              {t("tasks.review")}
            </Button>
          </ActionBar>
        </section>
      )}
      <div
        role="group"
        aria-label={t("tasks.filterLabel")}
        className="mb-4 flex flex-wrap gap-2"
      >
        {TASK_FILTERS.map((filter) => (
          <Button
            key={filter}
            size="sm"
            variant={list.filter === filter ? "default" : "outline"}
            aria-pressed={list.filter === filter}
            onClick={() => list.setFilter(filter)}
          >
            {t(`tasks.filters.${filter}`)}
            {counts && (
              <span className="font-mono opacity-70">{counts[filter]}</span>
            )}
          </Button>
        ))}
      </div>
      <p className="mb-4 text-xs leading-5 text-faint">
        {t("tasks.autoUpdate")}
      </p>
      {query.isPending && <PageLoading />}
      {query.isError && !query.isFetchNextPageError && (
        <div
          role="alert"
          className="mb-5 space-y-3 rounded-xl border border-destructive/30 p-4"
        >
          <p className="text-sm text-destructive">{t("tasks.errors.load")}</p>
          <ActionBar>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              {t("common.retry")}
            </Button>
          </ActionBar>
        </div>
      )}
      {firstPage &&
        (list.tasks.length ? (
          <section
            aria-label={t("tasks.listLabel")}
            className="overflow-hidden rounded-xl border bg-card"
          >
            <table className="w-full table-fixed text-left text-[13px] max-tablet:block">
              <colgroup className="max-tablet:hidden">
                <col className="w-[29%]" />
                <col className="w-[16%]" />
                <col className="w-[14%]" />
                <col className="w-[15%]" />
                <col className="w-[9%]" />
                <col className="w-[17%]" />
              </colgroup>
              <thead className="border-b bg-secondary text-xs text-faint max-tablet:hidden">
                <tr>
                  {(
                    [
                      "task",
                      "status",
                      "account",
                      "started",
                      "duration",
                      "actions",
                    ] as const
                  ).map((field) => (
                    <th
                      key={field}
                      scope="col"
                      className="px-4 py-3 last:text-right"
                    >
                      {t(`tasks.fields.${field}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y max-tablet:block">
                {list.tasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    now={query.dataUpdatedAt}
                    onView={list.select}
                    onAction={list.selectAction}
                  />
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center">
            <Activity className="size-7 text-faint" aria-hidden="true" />
            <h2 className="font-semibold">{t("tasks.empty.title")}</h2>
            <p className="max-w-md text-sm leading-6 text-muted-foreground">
              {t(
                list.filter === "all" && !list.projectId
                  ? "tasks.empty.description"
                  : "tasks.empty.filtered",
              )}
            </p>
            {list.filter !== "all" && (
              <ActionBar>
                <Button variant="outline" onClick={() => list.setFilter("all")}>
                  {t("tasks.empty.clear")}
                </Button>
              </ActionBar>
            )}
          </section>
        ))}
      {firstPage && (
        <div className="mt-4 space-y-3">
          <p role="status" className="text-xs text-faint">
            {t("tasks.showing", {
              count: list.tasks.length,
              total: firstPage.total,
            })}
          </p>
          {query.isFetchNextPageError && (
            <p role="alert" className="text-sm text-destructive">
              {t("tasks.errors.loadMore")}
            </p>
          )}
          {query.hasNextPage && (
            <ActionBar>
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={list.loadMore}
              >
                {t(
                  query.isFetchingNextPage
                    ? "common.loading"
                    : query.isFetchNextPageError
                      ? "common.retry"
                      : "tasks.loadMore",
                )}
              </Button>
            </ActionBar>
          )}
        </div>
      )}
      {list.selectedId && (
        <TaskDetailsSheet
          key={list.selectedId}
          id={list.selectedId}
          initialAction={list.initialAction}
          onClose={list.close}
          onCloseAutoFocus={list.restoreFocus}
        />
      )}
    </div>
  );
}
