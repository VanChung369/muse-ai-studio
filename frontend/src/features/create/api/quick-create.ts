import { z } from "zod";

import { libraryItemSchema } from "@/features/library/api/library";
import { taskSchema } from "@/features/tasks/schemas";
import { requestJson } from "@/lib/http";

export const quickCreateKey = ["quick-create"] as const;
export const MAX_QUICK_COUNT = 100;

export const quickBatchSchema = z.object({
  id: z.string(),
  kind: z.enum(["image", "video"]),
  prompt: z.string(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1"]),
  count: z.number().int().positive(),
  completedCount: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  tasks: taskSchema.array(),
  items: libraryItemSchema.array(),
});

export type QuickBatch = z.infer<typeof quickBatchSchema>;
export type QuickRequest = {
  kind: QuickBatch["kind"];
  prompt: string;
  aspectRatio: QuickBatch["aspectRatio"];
  count: number;
  referenceAssetId: string | null;
};

export async function fetchQuickBatches(signal?: AbortSignal) {
  return quickBatchSchema
    .array()
    .parse(await requestJson("/api/quick-create", { signal }));
}

export async function requestQuickCreate(values: QuickRequest) {
  return quickBatchSchema.parse(
    await requestJson("/api/quick-create", {
      method: "POST",
      body: JSON.stringify(values),
    }),
  );
}

export async function setQuickBatchHidden({
  batchId,
  hidden,
}: {
  batchId: string;
  hidden: boolean;
}) {
  const path = `/api/quick-create/${encodeURIComponent(batchId)}`;
  await requestJson(hidden ? path : `${path}/restore`, {
    method: hidden ? "DELETE" : "POST",
  });
}
