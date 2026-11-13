import { API_ENDPOINTS } from "@/constants/api";
import { requestJson } from "@/lib/http";
import { scriptGenerationTaskSchema } from "../schemas";

export const scriptGenerationKey = (id: string) =>
  ["projects", "script-generation", id] as const;

export async function fetchScriptGeneration(id: string, signal?: AbortSignal) {
  return scriptGenerationTaskSchema
    .nullable()
    .parse(
      await requestJson(
        `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(id)}/script-generation`,
        { signal },
      ),
    );
}

export async function startScriptGeneration(values: {
  projectId: string;
  accountId: string;
  idea: string;
  expectedRevision: number;
}) {
  const { projectId, ...body } = values;
  return scriptGenerationTaskSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(projectId)}/script-generation`,
      {
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  );
}

export async function cancelScriptGeneration(taskId: string) {
  return scriptGenerationTaskSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.TASKS}/${encodeURIComponent(taskId)}/cancel`,
      { method: "POST" },
    ),
  );
}
