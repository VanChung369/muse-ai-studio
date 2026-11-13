import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";

export function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <p className="font-mono text-sm text-primary">404</p>
      <h1 className="text-2xl font-semibold">{t("notFound.title")}</h1>
      <p className="max-w-sm text-sm leading-6 text-muted-foreground">
        {t("notFound.description")}
      </p>
      <Button asChild className="mt-2">
        <Link to={ROUTES.PROJECTS}>
          <ArrowLeft aria-hidden="true" />
          {t("notFound.back")}
        </Link>
      </Button>
    </div>
  );
}
