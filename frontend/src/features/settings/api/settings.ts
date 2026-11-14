import { z } from "zod";

import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_CONTINUITIES,
  PROJECT_LANGUAGES,
  PROJECT_LOOKS,
  PROJECT_MAX_SECONDS,
} from "@/features/projects/constants";
import { requestJson } from "@/lib/http";

const SETTINGS_ENDPOINT = "/api/settings";
const SYSTEM_ENDPOINT = "/api/system";

// What a new project starts from when nothing else is chosen.
export const projectDefaultsSchema = z.object({
  durationSeconds: z
    .number()
    .int()
    .min(10)
    .max(PROJECT_MAX_SECONDS)
    .multipleOf(5),
  aspectRatio: z.enum(PROJECT_ASPECT_RATIOS),
  language: z.enum(PROJECT_LANGUAGES),
  look: z.enum(PROJECT_LOOKS),
  continuity: z.enum(PROJECT_CONTINUITIES),
});

export const settingsSchema = z.object({
  projectDefaults: projectDefaultsSchema,
  // The address other machines reach the app at; null means "the address
  // of each request".
  publicUrl: z.string().nullable(),
});

const bytes = z.number().int().nonnegative();

export const systemSchema = z.object({
  version: z.string(),
  dataDir: z.string(),
  databaseRevision: z.string().nullable(),
  ffmpeg: z.object({
    path: z.string().nullable(),
    version: z.string().nullable(),
    captions: z.boolean(),
  }),
  browserPath: z.string().nullable(),
  storage: z.object({
    databaseBytes: bytes,
    projectsBytes: bytes,
    libraryBytes: bytes,
    freeBytes: bytes,
  }),
  limits: z.object({
    taskWorkers: z.number(),
    browserSlots: z.number(),
    planningTimeout: z.number(),
    renderTimeout: z.number(),
    threadSceneLimit: z.number(),
    sessionRefreshMinutes: z.number(),
    sessionRefreshWake: z.boolean(),
  }),
});

export type AppSettings = z.infer<typeof settingsSchema>;
export type ProjectDefaults = z.infer<typeof projectDefaultsSchema>;
export type SystemStatus = z.infer<typeof systemSchema>;

export const settingsKeys = {
  settings: ["settings"] as const,
  system: ["settings", "system"] as const,
};

export async function fetchSettings(signal?: AbortSignal) {
  return settingsSchema.parse(await requestJson(SETTINGS_ENDPOINT, { signal }));
}

export async function updateSettings(values: Partial<AppSettings>) {
  return settingsSchema.parse(
    await requestJson(SETTINGS_ENDPOINT, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  );
}

export async function fetchSystem(signal?: AbortSignal) {
  return systemSchema.parse(await requestJson(SYSTEM_ENDPOINT, { signal }));
}
