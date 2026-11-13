import { normalizeSearchText } from "@/lib/string";
import { ACCOUNT_FILTERS } from "../constants";
import type { Account, AccountFilter } from "../types";

export function resolveAccountFilter(value: string | null): AccountFilter {
  return ACCOUNT_FILTERS.find((filter) => filter === value) ?? "all";
}

export function getAccountCounts(accounts: Account[]) {
  const enabled = accounts.filter((account) => account.enabled).length;
  return { all: accounts.length, enabled, disabled: accounts.length - enabled };
}

export function getVisibleAccounts(
  accounts: Account[],
  query: string,
  filter: AccountFilter,
) {
  const search = normalizeSearchText(query.trim());
  return accounts.filter(
    (account) =>
      (filter === "all" || account.enabled === (filter === "enabled")) &&
      normalizeSearchText(account.label).includes(search),
  );
}
