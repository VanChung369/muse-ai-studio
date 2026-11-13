import { DEFAULT_LANGUAGE, LANGUAGES, type Language } from "@/constants/languages";

export function resolveLanguage(value: unknown): Language {
  return value === LANGUAGES.VIETNAMESE ? LANGUAGES.VIETNAMESE : DEFAULT_LANGUAGE;
}
