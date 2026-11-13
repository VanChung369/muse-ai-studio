import { useTranslation } from "react-i18next";

import type { NavigationItem } from "@/app/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { useDocumentTitle } from "@/hooks/use-document-title";

// Route placeholders for the shared shell. Each will become a feature page.
export function WorkspacePage({ page }: { page: NavigationItem }) {
  const { t } = useTranslation();
  const Icon = page.icon;
  const title = t(`pages.${page.id}.title`);
  useDocumentTitle(title);

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={title}
        description={t(`pages.${page.id}.description`)}
      />
      <section
        aria-label={t("navigation.workspaceLabel", { page: title })}
        className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed border-input px-6 py-16 text-center"
      >
        <div className="mb-4 grid size-12 place-items-center rounded-xl border bg-card text-primary">
          <Icon className="size-5" aria-hidden="true" />
        </div>
        <h2 className="max-w-md text-[15px] leading-5.5 font-semibold">
          {t(`pages.${page.id}.headline`)}
        </h2>
      </section>
    </div>
  );
}
