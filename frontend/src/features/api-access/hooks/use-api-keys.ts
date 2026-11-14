import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { createApiKey, fetchApiKeys, revokeApiKey } from "../api/api-keys";
import { apiKeyKeys } from "../api/query-keys";
import type { ApiKeyCreated, CreateApiKeyInput } from "../types";

export function useApiKeysQuery() {
  return useQuery({
    queryKey: apiKeyKeys.list,
    queryFn: ({ signal }) => fetchApiKeys(signal),
    retry: false,
  });
}

export function useCreateApiKey() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  // Send directly without TanStack useMutation so the returned full key
  // never enters the query/mutation cache.
  async function submit(values: CreateApiKeyInput): Promise<ApiKeyCreated> {
    setError(null);
    try {
      const created = await createApiKey(values);
      void client.invalidateQueries({ queryKey: apiKeyKeys.list });
      return created;
    } catch (caught) {
      setError(caught);
      throw caught;
    }
  }

  return {
    submit,
    error,
    resetError: () => setError(null),
  };
}

export function useRevokeApiKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: revokeApiKey,
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: apiKeyKeys.list });
    },
  });
}
