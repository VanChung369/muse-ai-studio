import { useEffect } from "react";

import { DEFAULT_LANGUAGE, type Language } from "@/constants/languages";
import { STORAGE_KEYS } from "@/constants/storage";
import { useLocalStorage } from "@/hooks/use-local-storage";
import i18n from "@/i18n";
import { resolveLanguage } from "@/lib/language";

export function useLanguage() {
  const [preference, setPreference] = useLocalStorage<Language>(
    STORAGE_KEYS.LANGUAGE,
    DEFAULT_LANGUAGE,
  );
  const language = resolveLanguage(preference);

  useEffect(() => {
    document.documentElement.lang = language;
    if (i18n.resolvedLanguage !== language) {
      void i18n.changeLanguage(language);
    }
  }, [language]);

  return [language, setPreference] as const;
}
