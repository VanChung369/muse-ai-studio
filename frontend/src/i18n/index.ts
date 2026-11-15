import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, type Language } from "@/constants/languages";
import { STORAGE_KEYS } from "@/constants/storage";
import { resolveLanguage } from "@/lib/language";
import { deserializeStoredValue, readLocalStorage } from "@/lib/storage";
import type vi from "./locales/vi.json";
import type { TranslationResources } from "./types";

// Every language has every text: checked here at build time, while only the
// language in use is downloaded (each locale is its own chunk).
const complete: TranslationResources = {} as typeof vi;
void complete;

const loaders: Record<Language, () => Promise<TranslationResources>> = {
  en: () => import("./locales/en.json").then((module) => module.default),
  vi: () => import("./locales/vi.json").then((module) => module.default),
};

/** Fetch a language's texts once, before it is shown. */
export async function loadLanguage(language: Language): Promise<void> {
  if (i18n.hasResourceBundle(language, "translation")) return;
  i18n.addResourceBundle(language, "translation", await loaders[language](), true, true);
}

export async function initializeI18n(): Promise<void> {
  const language = resolveLanguage(
    deserializeStoredValue(readLocalStorage(STORAGE_KEYS.LANGUAGE), DEFAULT_LANGUAGE),
  );

  await i18n.use(initReactI18next).init({
    resources: { [language]: { translation: await loaders[language]() } },
    partialBundledLanguages: true,
    lng: language,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    interpolation: { escapeValue: false },
    react: { useSuspense: false },
  });

  document.documentElement.lang = language;
}

export default i18n;
