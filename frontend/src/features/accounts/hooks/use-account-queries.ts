import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "@/lib/http";
import {
  deleteAccount,
  fetchAccounts,
  importAccount,
  patchAccount,
  runAccountOperation,
} from "../api/accounts";
import { accountKeys } from "../api/query-keys";
import type { AccountImport, AccountList } from "../types";

export function useAccountsQuery() {
  return useQuery({
    queryKey: accountKeys.list,
    queryFn: ({ signal }) => fetchAccounts(signal),
    retry: false,
  });
}

export function useImportAccount() {
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);

  async function submit(values: AccountImport) {
    // Import input includes credentials. Send it directly so it never
    // becomes a TanStack mutation variable retained in the cache.
    setError(null);
    try {
      const account = await importAccount(values);
      void client.invalidateQueries({ queryKey: accountKeys.list });
      return account;
    } catch (error) {
      setError(error);
      throw error;
    }
  }

  return { submit, error };
}

export function usePatchAccount() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: patchAccount,
    retry: false,
    onSuccess: (account) => {
      client.setQueryData<AccountList>(
        accountKeys.list,
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.map((item) =>
              item.id === account.id ? account : item,
            ),
          },
      );
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 404)
        void client.invalidateQueries({ queryKey: accountKeys.list });
    },
  });
}

export function useDeleteAccount() {
  // The row is not removed from the cache here: the confirmation dialog lives
  // inside it, and unmounting it mid-close would drop keyboard focus. The
  // dialog calls useForgetAccount() once it has closed.
  return useMutation({ mutationFn: deleteAccount, retry: false });
}

export function useForgetAccount() {
  const client = useQueryClient();
  return (id: string) => {
    void client.cancelQueries({ queryKey: accountKeys.list });
    client.setQueryData<AccountList>(accountKeys.list, (previous) => {
      if (!previous) return previous;
      const items = previous.items.filter((account) => account.id !== id);
      return { items, total: items.length };
    });
    void client.invalidateQueries({ queryKey: accountKeys.list });
  };
}

export function useAccountOperation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: runAccountOperation,
    retry: false,
    // Failures may still have changed health data server-side.
    onError: () => {
      void client.invalidateQueries({ queryKey: accountKeys.list });
    },
    onSuccess: ({ account }) => {
      client.setQueryData<AccountList>(
        accountKeys.list,
        (previous) =>
          previous && {
            ...previous,
            items: previous.items.map((item) =>
              item.id === account.id ? account : item,
            ),
          },
      );
    },
  });
}
