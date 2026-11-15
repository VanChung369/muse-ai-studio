import { useEffect } from "react";

import { DEFAULT_LANGUAGE, type Language } from "@/constants/languages";
import { STORAGE_KEYS } from "@/constants/storage";
import { useLocalStorage } from "@/hooks/use-local-storage";
import i18n, { loadLanguage } from "@/i18n";
import { resolveLanguage } from "@/lib/language";

export function useLanguage() {
  const [preference, setPreference] = useLocalStorage<Language>(
    STORAGE_KEYS.LANGUAGE,
    DEFAULT_LANGUAGE,
  );
  const language = resolveLanguage(preference);

  useEffect(() => {
    let cancelled = false;
    document.documentElement.lang = language;
    if (i18n.resolvedLanguage !== language) {
      // Its texts are fetched first, so the page never shows bare keys.
      void loadLanguage(language).then(() => {
        if (!cancelled) void i18n.changeLanguage(language);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [language]);

  return [language, setPreference] as const;
}
