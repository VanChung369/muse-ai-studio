import { useState } from "react";
import { useSearchParams } from "react-router";

import { ACCOUNT_QUERY_KEYS } from "../constants";
import {
  getAccountCounts,
  getVisibleAccounts,
  resolveAccountFilter,
} from "../lib/account-list";
import type { AccountFilter } from "../types";
import { useAccountsQuery } from "./use-account-queries";

export function useAccountList() {
  const query = useAccountsQuery();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<{
    kind: "imported" | "deleted";
    label: string;
  } | null>(null);
  const search = params.get(ACCOUNT_QUERY_KEYS.SEARCH) ?? "";
  const filter = resolveAccountFilter(params.get(ACCOUNT_QUERY_KEYS.FILTER));
  const accounts = query.data?.items ?? [];

  function updateParameter(key: string, value: string, fallback = "") {
    setNotice(null);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (value === fallback) next.delete(key);
        else next.set(key, value);
        return next;
      },
      { replace: true },
    );
  }

  function imported(label: string) {
    setNotice({ kind: "imported", label });
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete(ACCOUNT_QUERY_KEYS.SEARCH);
        next.delete(ACCOUNT_QUERY_KEYS.FILTER);
        return next;
      },
      { replace: true },
    );
  }

  return {
    query,
    search,
    filter,
    notice,
    visibleAccounts: getVisibleAccounts(accounts, search, filter),
    counts: getAccountCounts(accounts),
    setSearch: (value: string) =>
      updateParameter(ACCOUNT_QUERY_KEYS.SEARCH, value),
    setFilter: (value: AccountFilter) =>
      updateParameter(ACCOUNT_QUERY_KEYS.FILTER, value, "all"),
    imported,
    deleted: (label: string) => setNotice({ kind: "deleted", label }),
    clearFilters: () => {
      setNotice(null);
      setParams({}, { replace: true });
    },
  };
}
