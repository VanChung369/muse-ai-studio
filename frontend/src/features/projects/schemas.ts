import { z } from "zod";

import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_MAX_SCENES,
  PROJECT_MAX_SECONDS,
  PROJECT_CONTINUITIES,
  PROJECT_COVER_TONES,
  PROJECT_ERROR_CODES,
  PROJECT_LANGUAGES,
  PROJECT_LOOKS,
  PROJECT_STATUSES,
} from "./constants";

export const projectDraftSchema = z.object({
  name: z.string().trim().min(1).max(100),
  idea: z.string().trim().max(12000),
  aspectRatio: z.enum(PROJECT_ASPECT_RATIOS),
  durationSeconds: z
    .number()
    .int()
    .min(10)
    .max(PROJECT_MAX_SECONDS)
    .multipleOf(5),
});

// Optional starting points a script can build on.
const briefExtras = {
  characterBible: z.string().trim().max(10000),
  visualStyle: z.string().trim().max(3000),
  // The music the film should have; empty = none asked for.
  music: z.string().trim().max(500),
};

// What the "New project" form holds.
export const projectCreateSchema = projectDraftSchema.extend({
  ...briefExtras,
  look: z.enum(PROJECT_LOOKS),
  language: z.enum(PROJECT_LANGUAGES),
});

// A picture or video given as reference material for the film.
export const projectReferenceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  mime: z.string(),
  size: z.number().int().nonnegative(),
  url: z.string(),
});

// What the "Edit project" form holds: the brief plus the render options.
export const projectSettingsSchema = projectDraftSchema.extend({
  ...briefExtras,
  look: z.enum(PROJECT_LOOKS),
  continuity: z.enum(PROJECT_CONTINUITIES),
  language: z.enum(PROJECT_LANGUAGES),
  // A film without sound.
  mute: z.boolean(),
});

const sceneProgressIsValid = (project: {
  completedScenes: number;
  sceneCount: number;
}) => project.completedScenes <= project.sceneCount;

// Fields a project card needs: what GET /api/projects returns per item.
const projectSummaryShape = projectDraftSchema.omit({ idea: true }).extend({
  id: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  updatedAt: z.iso.datetime(),
  sceneCount: z.number().int().min(0).max(PROJECT_MAX_SCENES),
  completedScenes: z.number().int().min(0).max(PROJECT_MAX_SCENES),
  currentScene: z.number().int().min(1).max(PROJECT_MAX_SCENES).optional(),
  errorCode: z.enum(PROJECT_ERROR_CODES).optional(),
  coverTone: z.enum(PROJECT_COVER_TONES),
  // A still of the first rendered scene; null until one exists.
  coverUrl: z.string().nullable(),
});

export const projectSummarySchema =
  projectSummaryShape.refine(sceneProgressIsValid);

export const featuredProjectSchema = projectSummaryShape
  .extend({
    previewScenes: z.array(
      z.object({ number: z.number().int().min(1), title: z.string() }),
    ),
  })
  .refine(sceneProgressIsValid);

export const projectScriptSceneSchema = z.object({
  title: z.string().trim().min(1).max(300),
  prompt: z.string().trim().min(1).max(6000),
  durationSeconds: z.number().int().min(5).max(10).multipleOf(5),
  narration: z.string().trim().max(600),
});

export const projectScriptDraftSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  characterBible: z.string().trim().max(10000),
  visualStyle: z.string().trim().max(3000),
  scenes: projectScriptSceneSchema.array().min(1).max(PROJECT_MAX_SCENES),
});

// Full project from GET /api/projects/{id}.
export const projectSchema = projectSummaryShape
  .extend({
    idea: projectDraftSchema.shape.idea,
    look: z.enum(PROJECT_LOOKS),
    continuity: z.enum(PROJECT_CONTINUITIES),
    language: z.enum(PROJECT_LANGUAGES),
    mute: z.boolean(),
    music: z.string().max(500),
    references: projectReferenceSchema.array(),
    characterBible: z.string().max(10000),
    visualStyle: z.string().max(3000),
    scriptRevision: z.number().int().nonnegative(),
    scenes: z.array(
      projectScriptSceneSchema.extend({
        number: z.number().int().min(1).max(PROJECT_MAX_SCENES),
      }),
    ),
  })
  .refine(sceneProgressIsValid);

export const scriptGenerationRequestSchema = z.object({
  accountId: z.string().min(1),
  idea: z.string().trim().min(1).max(12000),
  language: z.enum(PROJECT_LANGUAGES),
  look: z.enum(PROJECT_LOOKS),
  // Write a voice-over line for every scene.
  narration: z.boolean(),
  // Free-form direction: tone, audience, pacing, must-haves.
  direction: z.string().trim().max(2000),
});

export const scriptGenerationTaskSchema = z.object({
  id: z.string(),
  status: z.enum([
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "interrupted",
  ]),
  cancelRequested: z.boolean(),
  submitted: z.boolean(),
  error: z
    .object({ code: z.string(), message: z.string().nullable() })
    .nullable(),
  result: z
    .object({ projectId: z.string(), script: projectScriptDraftSchema })
    .nullable(),
});
