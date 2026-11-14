import { z } from "zod";
import { TASK_STATUSES } from "./constants";

export const taskSchema = z.object({
  id: z.string(),
  kind: z.string(),
  status: z.enum(TASK_STATUSES),
  cancelRequested: z.boolean(),
  title: z.string(),
  projectId: z.string().nullable(),
  sceneNumber: z.number().int().nullable(),
  accountId: z.string().nullable(),
  accountLabel: z.string().nullable(),
  dependsOnId: z.string().nullable(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  progressPct: z.number().min(0).max(100).nullable(),
  error: z
    .object({ code: z.string(), message: z.string().nullable() })
    .nullable(),
  retryable: z.boolean(),
  suggestedAction: z
    .enum(["retry", "relogin", "switch_account", "check_proxy"])
    .nullable(),
  submitted: z.boolean(),
  // May be removed from the list; the server decides (finished, not a film's).
  deletable: z.boolean().default(false),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
});

export const taskCountsSchema = z.object({
  all: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  queued: z.number().int().nonnegative(),
  attention: z.number().int().nonnegative(),
  succeeded: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
});

export const taskListSchema = z.object({
  items: z.array(taskSchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
  counts: taskCountsSchema,
});
