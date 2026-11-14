import {
  ArrowRight,
  Check,
  CircleAlert,
  Clapperboard,
  Copy,
  KeyRound,
  Plus,
  Sparkles,
  SquareTerminal,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { AccountStatusBadge } from "@/features/accounts/components/account-status-badge";
import { useAccountsQuery } from "@/features/accounts/hooks/use-account-queries";
import { accountStatus } from "@/features/accounts/lib/account-format";
import type { AccountStatus } from "@/features/accounts/types";
import { ProjectCover } from "@/features/projects/components/project-cover";
import { ProjectProgress } from "@/features/projects/components/project-progress";
import { ProjectStatusBadge } from "@/features/projects/components/project-status-badge";
import { useProjectsQuery } from "@/features/projects/hooks/use-project-queries";
import {
  projectStepHref,
  resumeStep,
} from "@/features/projects/lib/project-list";
import type { ProjectSummary } from "@/features/projects/types";
import { usePublicOrigin } from "@/features/settings/hooks/use-settings";
import { TaskKindIcon } from "@/features/tasks/components/task-kind-icon";
import { TaskStatusBadge } from "@/features/tasks/components/task-status-badge";
import { TASK_QUERY_PARAMS } from "@/features/tasks/constants";
import { useTasksQuery } from "@/features/tasks/hooks/use-task-queries";
import {
  taskElapsed,
  taskErrorKey,
  taskKindKey,
} from "@/features/tasks/lib/task-format";
import type { Task } from "@/features/tasks/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { formatDuration, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

// How many rows each list shows before sending the reader to its own page.
const ROWS = 5;
// Account states that need the user, most urgent first.
const ACCOUNT_PROBLEMS: AccountStatus[] = ["expired", "proxyError", "lowQuota"];
// Every state an account can be in, in the order the summary lists them.
const ACCOUNT_STATES: AccountStatus[] = [
  "ready",
  "lowQuota",
  "expired",
  "proxyError",
  "unverified",
  "paused",
];
// Projects whose work is finished or was given up: nothing to continue.
const SETTLED = new Set(["completed", "cancelled"]);

const taskHref = (id: string) =>
  `${ROUTES.TASKS}?${new URLSearchParams({ [TASK_QUERY_PARAMS.SELECTED]: id })}`;
const tasksHref = (status: string) =>
  `${ROUTES.TASKS}?${new URLSearchParams({ [TASK_QUERY_PARAMS.STATUS]: status })}`;

export function OverviewPage() {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();
  const title = t("pages.overview.title");
  useDocumentTitle(title);

  const projects = useProjectsQuery({ q: "", status: "all", sort: "updated" });
  const running = useTasksQuery({ status: "running", projectId: null });
  const attention = useTasksQuery({ status: "attention", projectId: null });
  const accounts = useAccountsQuery();

  const recent = projects.data?.pages[0]?.items ?? [];
  const current = recent.find((project) => !SETTLED.has(project.status));
  const runningTasks = running.data?.pages[0]?.items ?? [];
  const queued = running.data?.pages[0]?.counts.queued ?? 0;
  const failedTasks = attention.data?.pages[0]?.items ?? [];
  const failedTotal = attention.data?.pages[0]?.total ?? 0;
  const states = (accounts.data?.items ?? []).map((account) => ({
    account,
    status: accountStatus(account, now),
  }));
  const troubled = states.filter(({ status }) =>
    ACCOUNT_PROBLEMS.includes(status),
  );
  // An account takes work when it is switched on and its session holds.
  const usable = states.filter(
    ({ status }) => status === "ready" || status === "lowQuota",
  ).length;

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={title}
        description={new Intl.DateTimeFormat(language, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }).format(now)}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ROUTES.CREATE}>
                <Sparkles aria-hidden="true" />
                {t("overview.quickCreate")}
              </Link>
            </Button>
            <Button asChild>
              <Link to={ROUTES.PROJECTS}>
                <Plus aria-hidden="true" />
                {t("overview.newProject")}
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-5 desktop:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            title={t("overview.continue.title")}
            link={{ to: ROUTES.PROJECTS, label: t("overview.allProjects") }}
            query={projects}
          >
            {current ? (
              <ContinueCard project={current} language={language} now={now} />
            ) : (
              <Empty
                icon={Clapperboard}
                text={t(
                  recent.length
                    ? "overview.continue.none"
                    : "overview.continue.empty",
                )}
                action={{
                  to: ROUTES.PROJECTS,
                  label: t("overview.newProject"),
                }}
              />
            )}
          </Panel>

          <Panel
            title={t("overview.running.title")}
            count={runningTasks.length + queued || undefined}
            link={{ to: ROUTES.TASKS, label: t("overview.allTasks") }}
            query={running}
          >
            {runningTasks.length ? (
              <ul className="divide-y">
                {runningTasks.slice(0, ROWS).map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    detail={
                      taskElapsed(task, running.dataUpdatedAt) ??
                      t("tasks.notStarted")
                    }
                  />
                ))}
              </ul>
            ) : (
              <Empty text={t("overview.running.empty")} />
            )}
            {queued > 0 && (
              <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
                <Link
                  to={tasksHref("queued")}
                  className="underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t("overview.running.queued", { count: queued })}
                </Link>
              </p>
            )}
          </Panel>

          <Panel
            title={t("overview.recent.title")}
            link={{ to: ROUTES.PROJECTS, label: t("overview.allProjects") }}
            query={projects}
          >
            {recent.length ? (
              <ul className="divide-y">
                {recent.slice(0, ROWS).map((project) => (
                  <li key={project.id}>
                    <Link
                      to={projectStepHref(project.id, resumeStep(project))}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary motion-reduce:transition-none"
                    >
                      <ProjectCover
                        project={project}
                        className="w-20 shrink-0 rounded-md"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {project.name}
                        </span>
                        <span className="mt-0.5 block text-xs text-faint">
                          {formatDuration(project.durationSeconds)} ·{" "}
                          {formatRelativeTime(project.updatedAt, language, now)}
                        </span>
                      </span>
                      <ProjectStatusBadge status={project.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <Empty text={t("overview.recent.empty")} />
            )}
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel
            title={t("overview.attention.title")}
            count={failedTotal + troubled.length || undefined}
            tone="alert"
            query={attention}
          >
            {failedTasks.length + troubled.length ? (
              <ul className="divide-y">
                {troubled.map(({ account, status }) => (
                  <li key={account.id}>
                    <Link
                      to={ROUTES.ACCOUNTS}
                      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary motion-reduce:transition-none"
                    >
                      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
                        <UsersRound className="size-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {account.label}
                      </span>
                      <AccountStatusBadge status={status} />
                    </Link>
                  </li>
                ))}
                {failedTasks.slice(0, ROWS).map((task) => (
                  <TaskLine
                    key={task.id}
                    task={task}
                    detail={
                      task.error ? t(taskErrorKey(task.error.code)) : undefined
                    }
                    alert
                  />
                ))}
              </ul>
            ) : (
              <Empty icon={Check} text={t("overview.attention.empty")} />
            )}
            {failedTotal > ROWS && (
              <p className="border-t px-4 py-2.5 text-xs">
                <Link
                  to={tasksHref("attention")}
                  className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  {t("overview.attention.more", { count: failedTotal - ROWS })}
                </Link>
              </p>
            )}
          </Panel>

          <Panel
            title={t("overview.accounts.title")}
            link={{ to: ROUTES.ACCOUNTS, label: t("overview.accounts.manage") }}
            query={accounts}
          >
            {states.length ? (
              <div className="px-4 py-4">
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-3xl font-semibold tabular-nums">
                    {usable}/{states.length}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {t("overview.accounts.usable")}
                  </span>
                </p>
                <ul className="mt-3 space-y-1.5">
                  {ACCOUNT_STATES.map((status) => {
                    const count = states.filter(
                      (entry) => entry.status === status,
                    ).length;
                    return count ? (
                      <li
                        key={status}
                        className="flex items-center justify-between gap-3"
                      >
                        <AccountStatusBadge status={status} />
                        <span className="font-mono text-sm tabular-nums">
                          {count}
                        </span>
                      </li>
                    ) : null;
                  })}
                </ul>
              </div>
            ) : (
              <Empty
                icon={UsersRound}
                text={t("overview.accounts.empty")}
                action={{
                  to: ROUTES.ACCOUNTS,
                  label: t("overview.accounts.import"),
                }}
              />
            )}
          </Panel>

          <Panel title={t("overview.shortcuts.title")}>
            <ul className="grid gap-1 p-2">
              <Shortcut
                to={ROUTES.CREATE}
                icon={Sparkles}
                label={t("overview.shortcuts.create")}
              />
              <Shortcut
                to={ROUTES.ACCOUNTS}
                icon={UsersRound}
                label={t("overview.shortcuts.importAccount")}
              />
              <li>
                <CopyBaseUrl />
              </li>
              <Shortcut
                to={ROUTES.API}
                icon={KeyRound}
                label={t("overview.shortcuts.apiKeys")}
              />
              <Shortcut
                to={ROUTES.PLAYGROUND}
                icon={SquareTerminal}
                label={t("overview.shortcuts.playground")}
              />
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// What a panel needs to know of the query behind it.
type Loadable = {
  isPending: boolean;
  isError: boolean;
  isFetching: boolean;
  refetch: () => unknown;
};

function Panel({
  title,
  count,
  link,
  tone,
  query,
  children,
}: {
  title: string;
  count?: number;
  link?: { to: string; label: string };
  tone?: "alert";
  query?: Loadable;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="truncate">{title}</span>
          {count !== undefined && (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums",
                tone === "alert"
                  ? "bg-destructive-soft text-destructive"
                  : "bg-accent text-muted-foreground",
              )}
            >
              {count}
            </span>
          )}
        </h2>
        {link && (
          <Link
            to={link.to}
            className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {link.label}
            <ArrowRight className="size-3" aria-hidden="true" />
          </Link>
        )}
      </header>
      {query?.isPending ? (
        <p role="status" className="px-4 py-8 text-center text-sm text-faint">
          {t("overview.loading")}
        </p>
      ) : query?.isError ? (
        <div role="alert" className="space-y-2 px-4 py-6 text-center">
          <p className="text-sm text-destructive">{t("overview.loadError")}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("overview.retry")}
          </Button>
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Empty({
  icon: Icon,
  text,
  action,
}: {
  icon?: LucideIcon;
  text: string;
  action?: { to: string; label: string };
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      {Icon && <Icon className="size-6 text-faint" aria-hidden="true" />}
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">{text}</p>
      {action && (
        <Button variant="outline" size="sm" asChild>
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}

function ContinueCard({
  project,
  language,
  now,
}: {
  project: ProjectSummary;
  language: string;
  now: number;
}) {
  const { t } = useTranslation();
  const step = resumeStep(project);
  return (
    <div className="flex flex-col gap-4 p-4 tablet:flex-row tablet:items-center">
      <ProjectCover project={project} className="tablet:w-64 tablet:shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectStatusBadge status={project.status} />
          <span className="text-xs text-faint">
            {t("projects.updated", {
              time: formatRelativeTime(project.updatedAt, language, now),
            })}
          </span>
        </div>
        <h3 className="text-lg leading-7 font-semibold wrap-break-word">
          {project.name}
        </h3>
        <p className="text-xs leading-5 text-faint">
          {project.aspectRatio} ·{" "}
          {t("projects.sceneCount", { count: project.sceneCount })} ·{" "}
          {formatDuration(project.durationSeconds)}
        </p>
        {project.status === "rendering" && (
          <ProjectProgress project={project} />
        )}
        {project.status === "failed" && (
          <p className="flex items-start gap-1.5 text-xs leading-5 text-destructive">
            <CircleAlert className="mt-1 size-3 shrink-0" aria-hidden="true" />
            {t("projects.error", {
              scene: project.currentScene ?? 1,
              reason: t(`projects.errors.${project.errorCode ?? "unknown"}`),
            })}
          </p>
        )}
        <div>
          <Button asChild className="mt-1">
            <Link to={projectStepHref(project.id, step)}>
              {t(`overview.continue.steps.${step}`)}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function TaskLine({
  task,
  detail,
  alert = false,
}: {
  task: Task;
  detail?: string;
  alert?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <li>
      <Link
        to={taskHref(task.id)}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-secondary motion-reduce:transition-none"
      >
        <TaskKindIcon kind={task.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            {task.title}
          </span>
          <span
            className={cn(
              "mt-0.5 block truncate text-xs",
              alert ? "text-destructive" : "text-faint",
            )}
          >
            {!alert && (
              <>
                {t(taskKindKey(task.kind))}
                {task.sceneNumber !== null &&
                  ` · ${t("tasks.scene", { number: task.sceneNumber })}`}
                {detail && " · "}
              </>
            )}
            {detail}
          </span>
        </span>
        <TaskStatusBadge task={task} />
      </Link>
    </li>
  );
}

const SHORTCUT =
  "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-secondary motion-reduce:transition-none";

function Shortcut({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <li>
      <Link to={to} className={SHORTCUT}>
        <Icon
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <ArrowRight
          className="size-3.5 shrink-0 text-faint"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

// The address other apps call: this app's own origin plus the API's prefix.
function CopyBaseUrl() {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = `${usePublicOrigin()}/v1`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setState("copied");
    } catch {
      // No clipboard on a plain-HTTP address: the URL is shown to copy by hand.
      setState("failed");
    }
  }

  return (
    <>
      <button type="button" onClick={() => void copy()} className={SHORTCUT}>
        <Copy
          className="size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate">
          {t("overview.shortcuts.copyBaseUrl")}
        </span>
        {state === "copied" && (
          <Check
            className="size-3.5 shrink-0 text-success"
            aria-hidden="true"
          />
        )}
      </button>
      <p role="status" className="px-2.5 text-xs text-faint empty:hidden">
        {state === "copied" && t("overview.shortcuts.copied")}
        {state === "failed" && (
          <>
            {t("overview.shortcuts.copyFailed")}{" "}
            <code className="font-mono wrap-anywhere text-foreground select-all">
              {url}
            </code>
          </>
        )}
      </p>
    </>
  );
}
