import { useTranslation } from "react-i18next";

import type { NavigationItem } from "@/app/navigation";
import { PageHeader } from "@/components/shared/page-header";

// Route placeholders for the shared shell. Each will become a feature page.
export function WorkspacePage({ page }: { page: NavigationItem }) {
  const { t } = useTranslation();
  const Icon = page.icon;
  const title = t(`pages.${page.id}.title`);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
      <PageHeader title={title} description={t(`pages.${page.id}.description`)} />
      <section
        aria-label={t("navigation.workspaceLabel", { page: title })}
        className="mt-8 flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed bg-card/35 px-6 py-16 text-center"
      >
        <div className="mb-5 flex size-12 items-center justify-center rounded-xl border bg-card text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <h2 className="max-w-md text-base leading-7 font-medium">
          {t(`pages.${page.id}.headline`)}
        </h2>
        <p className="mt-3 text-xs text-muted-foreground">{t("app.name")}</p>
      </section>
    </div>
  );
}

