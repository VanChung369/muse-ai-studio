import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

export function PageLoading() {
  const { t } = useTranslation();

  return (
    <div
      role="status"
      className="flex min-h-60 items-center justify-center gap-3 text-sm text-faint"
    >
      <LoaderCircle
        className="size-4 animate-spin motion-reduce:animate-none"
        aria-hidden="true"
      />
      {t("common.loading")}
    </div>
  );
}
