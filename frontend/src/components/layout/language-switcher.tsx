import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";

import { SUPPORTED_LANGUAGES } from "@/constants/languages";
import { useLanguage } from "@/hooks/use-language";
import { resolveLanguage } from "@/lib/language";

export function LanguageSwitcher() {
  const { t } = useTranslation();
  const [language, setLanguage] = useLanguage();

  return (
    <label className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border bg-card px-2 text-xs text-muted-foreground focus-within:border-ring">
      <Languages className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">{t("language.label")}</span>
      <select
        value={language}
        onChange={(event) => setLanguage(resolveLanguage(event.target.value))}
        className="min-w-0 bg-transparent py-1 pr-1 text-foreground outline-none"
      >
        {SUPPORTED_LANGUAGES.map((option) => (
          <option key={option} value={option}>{t(`language.names.${option}`)}</option>
        ))}
      </select>
    </label>
  );
}
