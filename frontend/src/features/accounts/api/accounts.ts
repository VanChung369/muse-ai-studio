import { API_ENDPOINTS } from "@/constants/api";
import { ApiError, requestJson } from "@/lib/http";
import {
  accountActionSchema,
  accountImportSchema,
  accountListSchema,
  accountSchema,
} from "../schemas";
import type {
  AccountImport,
  AccountPatch,
  AccountOperation,
  AccountEditMode,
  AccountEditValues,
} from "../types";

export async function fetchAccounts(signal?: AbortSignal) {
  return accountListSchema.parse(
    await requestJson(API_ENDPOINTS.ACCOUNTS, { signal }),
  );
}

export async function importAccount(values: AccountImport) {
  return accountSchema.parse(
    await requestJson(API_ENDPOINTS.ACCOUNTS, {
      method: "POST",
      body: JSON.stringify(accountImportSchema.parse(values)),
    }),
  );
}

export async function patchAccount({
  id,
  values,
}: {
  id: string;
  values: AccountPatch;
}) {
  return accountSchema.parse(
    await requestJson(`${API_ENDPOINTS.ACCOUNTS}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(values),
    }),
  );
}

export async function deleteAccount(id: string) {
  try {
    await requestJson(`${API_ENDPOINTS.ACCOUNTS}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}

export async function runAccountOperation({
  id,
  action,
}: {
  id: string;
  action: AccountOperation;
}) {
  return accountActionSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.ACCOUNTS}/${encodeURIComponent(id)}/${action}`,
      { method: "POST" },
    ),
  );
}

export async function editAccount(
  id: string,
  mode: AccountEditMode,
  values: AccountEditValues,
) {
  if (mode === "rename" || mode === "notes")
    return patchAccount({
      id,
      values:
        mode === "rename" ? { label: values.label } : { notes: values.notes },
    });
  const body =
    mode === "cookies"
      ? { cookieText: values.cookieText }
      : {
          proxy: values.server
            ? {
                server: values.server,
                username: values.username,
                ...(values.password ? { password: values.password } : {}),
              }
            : null,
        };
  return accountSchema.parse(
    await requestJson(
      `${API_ENDPOINTS.ACCOUNTS}/${encodeURIComponent(id)}/${mode}`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    ),
  );
}
