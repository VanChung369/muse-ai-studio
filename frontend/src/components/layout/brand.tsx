import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { ROUTES } from "@/constants/routes";
import { cn } from "@/lib/utils";

export function Brand({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const brandName = t("app.brandName");

  return (
    <Link
      to={ROUTES.PROJECTS}
      aria-label={t("navigation.brandLabel", { appName: t("app.name"), page: t("pages.projects.title") })}
      className={cn(
        "flex shrink-0 items-center gap-2.5 rounded-lg text-[15px] leading-none font-bold tracking-[0.04em] text-foreground",
        compact && "justify-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="grid size-7 shrink-0 place-items-center rounded-[7px] bg-primary text-[13px] leading-none font-extrabold tracking-normal text-primary-foreground"
      >
        {brandName.charAt(0)}
      </span>
      {!compact && (
        <span className="whitespace-nowrap">
          {brandName}{" "}
          <span className="font-normal text-muted-foreground">{t("app.brandSuffix")}</span>
        </span>
      )}
    </Link>
  );
}
