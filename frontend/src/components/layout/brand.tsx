import { Clapperboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { cn } from "@/lib/utils";
import { ROUTES } from "@/constants/routes";

export function Brand({
  compact = false,
  responsive = false,
}: {
  compact?: boolean;
  responsive?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <Link
      to={ROUTES.PROJECTS}
      aria-label={t("navigation.brandLabel", { appName: t("app.name"), page: t("pages.projects.title") })}
      className="flex min-h-12 items-center gap-2.5 rounded-lg px-2 text-foreground"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <Clapperboard className="size-4.5" aria-hidden="true" />
      </span>
      {!compact && (
        <span
          className={cn(
            "whitespace-nowrap text-[14px] font-semibold tracking-tight",
            responsive && "hidden xl:inline",
          )}
        >
          {t("app.brandName")}{" "}
          <span className="font-normal text-muted-foreground">{t("app.brandSuffix")}</span>
        </span>
      )}
    </Link>
  );
}
