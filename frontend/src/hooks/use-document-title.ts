import { useEffect } from "react";
import { useTranslation } from "react-i18next";

export function useDocumentTitle(title: string) {
  const { t } = useTranslation();
  const documentTitle = t("app.documentTitle", {
    title,
    appName: t("app.name"),
  });

  useEffect(() => {
    document.title = documentTitle;
  }, [documentTitle]);
}
