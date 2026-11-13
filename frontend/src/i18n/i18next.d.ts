import "i18next";

import type { TranslationResources } from "./types";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    strictKeyChecks: true;
    resources: {
      translation: TranslationResources;
    };
  }
}
