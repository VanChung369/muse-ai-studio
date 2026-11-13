export const LANGUAGES = {
  ENGLISH: "en",
  VIETNAMESE: "vi",
} as const;

export type Language = (typeof LANGUAGES)[keyof typeof LANGUAGES];

export const DEFAULT_LANGUAGE: Language = LANGUAGES.ENGLISH;
export const SUPPORTED_LANGUAGES: Language[] = Object.values(LANGUAGES);
