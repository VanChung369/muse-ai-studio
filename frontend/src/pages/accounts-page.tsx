import { Check, RefreshCw, Search, UsersRound } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountRow } from "@/features/accounts/components/account-row";
import { ImportAccountDialog } from "@/features/accounts/components/import-account-dialog";
import {
  ACCOUNT_COLUMNS,
  ACCOUNT_FILTERS,
} from "@/features/accounts/constants";
import { useAccountList } from "@/features/accounts/hooks/use-account-list";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function AccountsPage() {
  const { t } = useTranslation();
  const id = useId();
  const list = useAccountList();
  useDocumentTitle(t("pages.accounts.title"));

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.accounts.title")}
        description={t("pages.accounts.description")}
        actions={<ImportAccountDialog onImported={list.imported} />}
      />
      {list.notice && (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {t(
            list.notice.kind === "imported"
              ? "accounts.import.success"
              : "accounts.delete.success",
            { label: list.notice.label },
          )}
        </p>
      )}
      <p className="mb-6 rounded-xl border border-dashed p-4 text-xs leading-6 text-muted-foreground">
        {t("accounts.verificationNote")}
      </p>
      {list.query.isPending && <PageLoading />}
      {list.query.isError && (
        <div
          role="alert"
          className="mb-5 space-y-3 rounded-xl border border-destructive/30 p-5"
        >
          <p className="text-sm text-muted-foreground">
            {t("accounts.errors.load")}
          </p>
          <Button
            variant="outline"
            disabled={list.query.isFetching}
            onClick={() => void list.query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}
      {list.query.data && (
        <>
          <dl className="mb-6 grid grid-cols-3 gap-3">
            {ACCOUNT_FILTERS.map((filter) => (
              <div key={filter} className="rounded-xl border bg-card p-4">
                <dt className="text-xs text-faint">
                  {t(`accounts.filters.${filter}`)}
                </dt>
                <dd className="mt-2 font-mono text-2xl font-semibold">
                  {list.counts[filter]}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label={t("accounts.filterLabel")}
              className="flex flex-wrap gap-2"
            >
              {ACCOUNT_FILTERS.map((filter) => (
                <Button
                  key={filter}
                  variant={list.filter === filter ? "default" : "outline"}
                  size="sm"
                  aria-pressed={list.filter === filter}
                  onClick={() => list.setFilter(filter)}
                >
                  {t(`accounts.filters.${filter}`)}
                </Button>
              ))}
            </div>
            <div className="flex w-full gap-2 tablet:w-auto">
              <div className="relative min-w-0 flex-1">
                <label htmlFor={id} className="sr-only">
                  {t("accounts.search")}
                </label>
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint"
                  aria-hidden="true"
                />
                <Input
                  id={id}
                  type="search"
                  maxLength={100}
                  value={list.search}
                  onChange={(event) => list.setSearch(event.target.value)}
                  placeholder={t("accounts.searchPlaceholder")}
                  className="h-9 pl-9 max-tablet:h-11 tablet:w-64"
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                disabled={list.query.isFetching}
                aria-label={t("accounts.refresh")}
                onClick={() => void list.query.refetch()}
              >
                <RefreshCw
                  className={
                    list.query.isFetching
                      ? "animate-spin motion-reduce:animate-none"
                      : undefined
                  }
                  aria-hidden="true"
                />
              </Button>
            </div>
          </div>
          {list.visibleAccounts.length ? (
            <section
              aria-label={t("accounts.listLabel")}
              className="rounded-xl border bg-card"
            >
              <table className="w-full table-fixed border-collapse text-left text-[13px] max-tablet:block">
                <colgroup className="max-tablet:hidden">
                  <col className="w-[26%]" />
                  <col className="w-[20%]" />
                  <col className="w-[19%]" />
                  <col className="w-[19%]" />
                  <col className="w-[16%]" />
                </colgroup>
                <thead className="border-b bg-secondary text-[11px] font-medium text-faint max-tablet:hidden">
                  <tr>
                    {ACCOUNT_COLUMNS.map((field) => (
                      <th key={field} scope="col" className="px-4 py-3">
                        {t(`accounts.fields.${field}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="max-tablet:block">
                  {list.visibleAccounts.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      onDeleted={list.deleted}
                    />
                  ))}
                </tbody>
              </table>
            </section>
          ) : (
            <section className="flex flex-col items-center gap-3 rounded-xl border px-6 py-14 text-center">
              <UsersRound className="size-7 text-faint" aria-hidden="true" />
              <h2 className="text-base font-semibold">
                {t(
                  list.counts.all
                    ? "accounts.empty.noResults"
                    : "accounts.empty.title",
                )}
              </h2>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                {t(
                  list.counts.all
                    ? "accounts.empty.noResultsDescription"
                    : "accounts.empty.description",
                )}
              </p>
              {list.counts.all > 0 && (
                <Button variant="outline" onClick={list.clearFilters}>
                  {t("accounts.empty.clear")}
                </Button>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
