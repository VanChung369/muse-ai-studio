import { Activity } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ROUTES } from "@/constants/routes";
import { useTaskSummary } from "../hooks/use-task-queries";

export function TaskIndicator() {
  const { t } = useTranslation();
  const query = useTaskSummary();
  const counts = query.isError ? undefined : query.data;
  const active = counts ? counts.running + counts.queued : 0;
  return (
    <Link
      to={ROUTES.TASKS}
      title={query.isError ? t("tasks.errors.load") : undefined}
      className="hidden h-8 items-center gap-2 rounded-full border border-input px-3 text-[13px] leading-none font-medium text-muted-foreground hover:border-faint hover:text-foreground tablet:inline-flex"
    >
      <Activity className="size-3.5" aria-hidden="true" />
      {t("pages.tasks.title")}
      {active > 0 && (
        <span
          className="font-mono text-primary"
          aria-label={t("tasks.activeCount", { count: active })}
        >
          {active}
        </span>
      )}
      {counts && counts.attention > 0 && (
        <span
          className="size-2 rounded-full bg-destructive"
          role="img"
          aria-label={t("tasks.attentionCount", { count: counts.attention })}
        />
      )}
      {query.isError && <span aria-label={t("tasks.errors.load")}>!</span>}
    </Link>
  );
}
