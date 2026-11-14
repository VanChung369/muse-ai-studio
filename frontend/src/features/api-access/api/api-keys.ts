import { API_ENDPOINTS } from "@/constants/api";
import { ApiError, requestJson } from "@/lib/http";
import {
  apiKeyCreatedSchema,
  apiKeyListSchema,
  apiKeyRevealSchema,
  createApiKeyFormSchema,
} from "../schemas";
import type { ApiKey, ApiKeyCreated, CreateApiKeyInput } from "../types";

export async function fetchApiKeys(signal?: AbortSignal): Promise<ApiKey[]> {
  return apiKeyListSchema.parse(
    await requestJson(API_ENDPOINTS.API_KEYS, { signal }),
  );
}

export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<ApiKeyCreated> {
  return apiKeyCreatedSchema.parse(
    await requestJson(API_ENDPOINTS.API_KEYS, {
      method: "POST",
      body: JSON.stringify(createApiKeyFormSchema.parse(input)),
    }),
  );
}

export async function revealApiKey(
  id: string,
  signal?: AbortSignal,
): Promise<string> {
  const result = apiKeyRevealSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.API_KEYS}/${encodeURIComponent(id)}/reveal`,
      {
        method: "POST",
        signal,
      },
    ),
  );
  return result.key;
}

export async function revokeApiKey(id: string): Promise<void> {
  try {
    await requestJson(`${API_ENDPOINTS.API_KEYS}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}
