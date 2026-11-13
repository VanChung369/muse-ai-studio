import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from "@/constants/languages";
import { STORAGE_KEYS } from "@/constants/storage";
import { resolveLanguage } from "@/lib/language";
import { deserializeStoredValue, readLocalStorage } from "@/lib/storage";
import en from "./locales/en.json";
import vi from "./locales/vi.json";
import type { TranslationResources } from "./types";

const resources: Record<Language, { translation: TranslationResources }> = {
  en: { translation: en },
  vi: { translation: vi },
};

export async function initializeI18n(): Promise<void> {
  const language = resolveLanguage(
    deserializeStoredValue(readLocalStorage(STORAGE_KEYS.LANGUAGE), DEFAULT_LANGUAGE),
  );

  await i18n.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  document.documentElement.lang = language;
}

export default i18n;
