import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "@/hooks/use-language";
import { cn } from "@/lib/utils";
import { formatAccountDate } from "../lib/account-format";
import type { Account } from "../types";
import { AccountActions } from "./account-actions";

// One row per account with related fields grouped into five columns, so the
// table fits its container without horizontal scrolling. Below the tablet
// breakpoint each row becomes a card and every cell shows its own label.
export function AccountRow({
  account,
  onDeleted,
}: {
  account: Account;
  onDeleted: (label: string) => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const date = (value: string | null, fallback = "") =>
    formatAccountDate(value, language, fallback);

  return (
    <tr
      data-account-id={account.id}
      className="border-b align-top last:border-b-0 max-tablet:grid max-tablet:grid-cols-2 max-tablet:gap-x-4 max-tablet:gap-y-4 max-tablet:p-4 tablet:[&>td]:px-4 tablet:[&>td]:py-4"
    >
      <Cell className="max-tablet:col-span-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-semibold wrap-anywhere">
            {account.label}
          </span>
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[11px]",
              account.enabled
                ? "bg-success-soft text-success"
                : "bg-secondary text-faint",
            )}
          >
            {t(
              account.enabled
                ? "accounts.status.enabled"
                : "accounts.status.disabled",
            )}
          </span>
        </div>
        <p className="mt-1 font-mono text-[11px] wrap-anywhere text-faint select-all">
          {t("accounts.cells.id", { value: account.id })}
        </p>
        {account.notes && (
          <p
            className="mt-2 line-clamp-2 text-xs whitespace-pre-wrap text-muted-foreground wrap-anywhere"
            title={account.notes}
          >
            {account.notes}
          </p>
        )}
      </Cell>

      <Cell label={t("accounts.fields.session")}>
        <span
          className={cn(
            "inline-block rounded-md border px-2 py-0.5 text-xs",
            account.sessionStatus === "valid"
              ? "border-success/30 text-success"
              : account.sessionStatus === "invalid"
                ? "border-destructive/30 text-destructive"
                : "text-faint",
          )}
        >
          {t(`accounts.status.${account.sessionStatus}`)}
        </span>
        <Details>
          {account.lastCheckedAt && (
            <p>
              {t("accounts.cells.checked", {
                value: date(account.lastCheckedAt),
              })}
            </p>
          )}
          {account.lastError && (
            <p className="text-destructive">
              {t("accounts.lastOperationFailed")}
            </p>
          )}
          <p>
            {t("accounts.cells.expires", {
              value: date(account.expiresAt, t("accounts.unknown")),
            })}
          </p>
          <p>{t("accounts.cookieCount", { count: account.cookieCount })}</p>
        </Details>
      </Cell>

      <Cell label={t("accounts.fields.quota")}>
        {account.quota ? (
          <Details className="mt-0">
            <p className="text-muted-foreground">
              {account.quota.plan ?? t("accounts.unknown")}
            </p>
            <p>
              {t("accounts.quota.used", {
                percent: account.quota.weeklyUsedPct,
              })}
            </p>
            {account.quota.weeklyReset && (
              <p>
                {t("accounts.quota.reset", {
                  value: account.quota.weeklyReset,
                })}
              </p>
            )}
            {account.quota.extraLeft && <p>{account.quota.extraLeft}</p>}
            {account.quotaCheckedAt && (
              <p className="text-faint">
                {t("accounts.cells.checked", {
                  value: date(account.quotaCheckedAt),
                })}
              </p>
            )}
          </Details>
        ) : (
          <p className="text-xs text-faint">{t("accounts.notChecked")}</p>
        )}
      </Cell>

      <Cell
        label={t("accounts.fields.connection")}
        className="max-tablet:col-span-2"
      >
        {account.proxy ? (
          <>
            <p className="text-xs wrap-anywhere text-muted-foreground">
              {account.proxy.server}
            </p>
            {account.proxy.username && (
              <p className="mt-0.5 text-xs wrap-anywhere text-faint">
                {account.proxy.username}
              </p>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t("accounts.proxy.direct")}
          </p>
        )}
        <Details>
          <p>
            {t("accounts.cells.lastUsed", {
              value: date(account.lastUsedAt, t("accounts.neverUsed")),
            })}
          </p>
        </Details>
      </Cell>

      <Cell className="max-tablet:col-span-2">
        <AccountActions account={account} onDeleted={onDeleted} />
      </Cell>
    </tr>
  );
}

function Cell({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td className={cn("min-w-0 max-tablet:block", className)}>
      {label && (
        // The column header is hidden on phones, so each card cell names itself.
        <span className="mb-1.5 block text-[11px] font-medium text-faint tablet:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  );
}

function Details({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mt-2 space-y-0.5 text-xs leading-5 text-muted-foreground",
        className,
      )}
    >
      {children}
    </div>
  );
}
