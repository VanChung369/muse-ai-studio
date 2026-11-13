import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function NotFoundPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("notFound.title"));

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="font-mono text-sm font-medium text-primary">404</p>
      <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">
        {t("notFound.title")}
      </h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {t("notFound.description")}
      </p>
      <Button asChild className="mt-3">
        <Link to={ROUTES.PROJECTS}>
          <ArrowLeft aria-hidden="true" />
          {t("notFound.back")}
        </Link>
      </Button>
    </div>
  );
}
