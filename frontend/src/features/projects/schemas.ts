import { z } from "zod";

import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_COVER_TONES,
  PROJECT_ERROR_CODES,
  PROJECT_STATUSES,
} from "./constants";

export const projectDraftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  idea: z.string().trim().max(12000),
  aspectRatio: z.enum(PROJECT_ASPECT_RATIOS),
  durationSeconds: z.number().int().min(10).max(300).multipleOf(5),
});

export const projectSchema = projectDraftSchema
  .extend({
    id: z.string().min(1),
    status: z.enum(PROJECT_STATUSES),
    updatedAt: z.iso.datetime(),
    sceneCount: z.number().int().min(0).max(30),
    completedScenes: z.number().int().min(0).max(30),
    currentScene: z.number().int().min(1).max(30).optional(),
    errorCode: z.enum(PROJECT_ERROR_CODES).optional(),
    coverTone: z.enum(PROJECT_COVER_TONES),
    scenes: z.array(
      z.object({
        number: z.number().int().min(1),
        title: z.string(),
        prompt: z.string(),
      }),
    ),
  })
  .refine((project) => project.completedScenes <= project.sceneCount);
