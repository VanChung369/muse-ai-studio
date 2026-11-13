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

const sceneProgressIsValid = (project: {
  completedScenes: number;
  sceneCount: number;
}) => project.completedScenes <= project.sceneCount;

// Fields a project card needs: what GET /api/projects returns per item.
const projectSummaryShape = projectDraftSchema.omit({ idea: true }).extend({
  id: z.string().min(1),
  status: z.enum(PROJECT_STATUSES),
  updatedAt: z.iso.datetime(),
  sceneCount: z.number().int().min(0).max(30),
  completedScenes: z.number().int().min(0).max(30),
  currentScene: z.number().int().min(1).max(30).optional(),
  errorCode: z.enum(PROJECT_ERROR_CODES).optional(),
  coverTone: z.enum(PROJECT_COVER_TONES),
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
  scenes: projectScriptSceneSchema.array().min(1).max(30),
});

// Full project from GET /api/projects/{id}.
export const projectSchema = projectSummaryShape
  .extend({
    idea: projectDraftSchema.shape.idea,
    characterBible: z.string().max(10000),
    visualStyle: z.string().max(3000),
    scriptRevision: z.number().int().nonnegative(),
    scenes: z.array(
      projectScriptSceneSchema.extend({
        number: z.number().int().min(1).max(30),
      }),
    ),
  })
  .refine(sceneProgressIsValid);
