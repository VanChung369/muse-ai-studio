import { z } from "zod";

import { MAX_COOKIE_TEXT } from "./constants";

export const accountSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(100),
  enabled: z.boolean(),
  cookieCount: z.number().int().min(1).max(100),
  sessionStatus: z.enum(["unverified", "valid", "invalid"]),
  expiresAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
  lastCheckedAt: z.iso.datetime().nullable(),
  lastKeepaliveAt: z.iso.datetime().nullable(),
  quotaCheckedAt: z.iso.datetime().nullable(),
  notes: z.string().max(2000),
  lastError: z.string().nullable(),
  runningTasks: z.number().int().nonnegative(),
  credentialVersion: z.number().int().nonnegative(),
  proxy: z
    .object({
      server: z.string(),
      username: z.string(),
      hasPassword: z.boolean(),
    })
    .nullable(),
  quota: z
    .object({
      plan: z.string().nullable(),
      weeklyUsedPct: z.number().min(0).max(100),
      weeklyReset: z.string().nullable(),
      extraUsedPct: z.number().nullable(),
      extraLeft: z.string().nullable(),
      extraExpires: z.string().nullable(),
    })
    .nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const accountImportSchema = z.object({
  label: z.string().trim().min(1).max(100),
  cookieText: z.string().trim().min(1).max(MAX_COOKIE_TEXT),
});

export const accountLabelSchema = accountImportSchema.pick({ label: true });
export const accountListSchema = z.object({
  items: accountSchema.array(),
  total: z.number().int().nonnegative(),
});

export const accountActionSchema = z.object({
  account: accountSchema,
  ok: z.boolean(),
  code: z.string(),
  vmState: z.string().nullable(),
});

export function accountEditSchema(mode: string) {
  return z
    .object({
      label: z.string().trim().min(1).max(100),
      notes: z.string().trim().max(2000),
      cookieText: z.string().trim().max(MAX_COOKIE_TEXT),
      server: z.string().trim().max(2048),
      username: z.string().max(256),
      password: z.string().max(1024),
      clearPassword: z.boolean(),
    })
    .superRefine((values, context) => {
      if (mode === "cookies" && !values.cookieText)
        context.addIssue({
          code: "custom",
          path: ["cookieText"],
          message: "Cookie input is required.",
        });
    });
}
