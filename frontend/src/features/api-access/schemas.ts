import { z } from "zod";

import { API_KEY_NAME_MAX_LENGTH } from "./constants";

export const apiKeySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  masked: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  lastUsedAt: z.iso.datetime({ offset: true }).nullable(),
});

export const apiKeyListSchema = apiKeySchema.array();

export const apiKeyCreatedSchema = apiKeySchema.extend({
  key: z.string().min(1),
});

export const apiKeyRevealSchema = z.object({
  key: z.string().min(1),
});

export const createApiKeyFormSchema = z.object({
  name: z.string().trim().min(1).max(API_KEY_NAME_MAX_LENGTH),
});

export const openAiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string(),
    code: z.string().nullable().optional(),
  }),
});

export const videoGenerationSchema = z.object({
  id: z.string().min(1),
  object: z.string().optional(),
  status: z.enum(["queued", "in_progress", "succeeded", "failed", "cancelled"]),
  created: z.number().optional(),
  model: z.string().optional(),
  data: z.array(z.object({ url: z.string() })).optional(),
  error: z
    .object({
      message: z.string(),
      type: z.string().optional(),
      code: z.string().nullable().optional(),
    })
    .optional(),
});
