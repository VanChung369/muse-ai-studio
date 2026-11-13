import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LOW_QUOTA_PCT } from "../constants";
import {
  accountStatus,
  formatAccountDate,
  formatTimeLeft,
  remainingPct,
} from "../lib/account-format";
import type { Account } from "../types";
import { AccountActions } from "./account-actions";
import { AccountStatusBadge } from "./account-status-badge";

// One row per account (design/source/src/Accounts.dc.html): a main value per
// cell with an optional faint caption under it. Below the tablet breakpoint
// each row becomes a card and every cell shows its own label.
export function AccountRow({
  account,
  onDeleted,
}: {
  account: Account;
  onDeleted: (label: string) => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();
  const relative = (value: string) => formatRelativeTime(value, language, now);

  const status = accountStatus(account, now);
  const { quota, expiresAt, proxy } = account;
  const expired = expiresAt !== null && Date.parse(expiresAt) <= now;
  const proxyFailed = account.lastError === "proxy_error";
  const quotaNote =
    quota &&
    [
      quota.plan,
      quota.weeklyReset &&
        t("accounts.quota.reset", { value: quota.weeklyReset }),
      quota.extraLeft,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <tr
      data-account-id={account.id}
      className="border-b last:border-b-0 max-tablet:grid max-tablet:grid-cols-2 max-tablet:gap-x-4 max-tablet:gap-y-4 max-tablet:p-4 tablet:align-middle tablet:hover:bg-white/2.5 tablet:[&>td]:px-3 tablet:[&>td]:py-2.75"
    >
      <Cell className="max-tablet:col-span-2">
        <p className="truncate font-medium" title={account.label}>
          {account.label}
        </p>
        <p
          className="truncate font-mono text-xs text-faint select-all"
          title={account.id}
        >
          {account.id}
        </p>
        {account.notes && (
          <p
            className="mt-0.5 truncate text-xs text-muted-foreground"
            title={account.notes}
          >
            {account.notes}
          </p>
        )}
      </Cell>

      <Cell label={t("accounts.fields.status")}>
        <AccountStatusBadge status={status} />
        {account.lastError &&
          status !== "expired" &&
          status !== "proxyError" && (
            <Caption className="text-destructive">
              {t("accounts.lastOperationFailed")}
            </Caption>
          )}
      </Cell>

      <Cell label={t("accounts.fields.quota")}>
        {quota ? (
          // Muse reports two allowances: the weekly limit and extra tokens.
          <div className="grid grid-cols-[auto_minmax(2rem,5.5rem)_auto] items-center justify-start gap-x-2 gap-y-1.5">
            <QuotaBar
              label={t("accounts.quota.weekly")}
              usedPct={quota.weeklyUsedPct}
            />
            <QuotaBar
              label={t("accounts.quota.extra")}
              usedPct={quota.extraUsedPct}
            />
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            <span
              className={cn(TRACK_CLASS, "w-22 min-w-8 shrink")}
              aria-hidden="true"
            />
            <span className="text-[13px] whitespace-nowrap text-muted-foreground">
              {t("accounts.notChecked")}
            </span>
          </div>
        )}
        {quotaNote && (
          <Caption
            title={
              account.quotaCheckedAt
                ? t("accounts.cells.checked", {
                    value: formatAccountDate(
                      account.quotaCheckedAt,
                      language,
                      "",
                    ),
                  })
                : undefined
            }
          >
            {quotaNote}
          </Caption>
        )}
      </Cell>

      <Cell label={t("accounts.fields.session")}>
        <p
          className={cn(
            "text-[13px]",
            expired || account.sessionStatus === "invalid"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
          title={[
            formatAccountDate(expiresAt, language, ""),
            t("accounts.cookieCount", { count: account.cookieCount }),
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {expired
            ? t("accounts.session.expired", { value: relative(expiresAt) })
            : account.sessionStatus === "invalid"
              ? t("accounts.session.invalid")
              : expiresAt === null
                ? t("accounts.unknown")
                : t("accounts.session.left", {
                    value: formatTimeLeft(
                      Date.parse(expiresAt) - now,
                      language,
                    ),
                  })}
        </p>
        {account.lastCheckedAt && (
          <Caption>
            {t("accounts.cells.checked", {
              value: relative(account.lastCheckedAt),
            })}
          </Caption>
        )}
      </Cell>

      <Cell label={t("accounts.fields.proxy")}>
        <p
          className={cn(
            "truncate text-[13px]",
            proxyFailed ? "text-destructive" : "text-muted-foreground",
          )}
          title={
            proxy
              ? [proxy.server, proxy.username].filter(Boolean).join(" · ")
              : undefined
          }
        >
          {!proxy
            ? t("accounts.proxy.direct")
            : proxyFailed
              ? t("accounts.proxy.failed", { server: proxyHost(proxy.server) })
              : proxyHost(proxy.server)}
        </p>
        <Caption>
          {t("accounts.cells.lastUsed", {
            value: account.lastUsedAt
              ? relative(account.lastUsedAt)
              : t("accounts.neverUsed"),
          })}
        </Caption>
      </Cell>

      <Cell className="max-tablet:col-span-2">
        <AccountActions account={account} onDeleted={onDeleted} />
      </Cell>
    </tr>
  );
}

const TRACK_CLASS = "block h-1.5 overflow-hidden rounded-full bg-accent";

// One labelled bar of a quota cell's grid; an unread allowance shows an empty track.
function QuotaBar({
  label,
  usedPct,
}: {
  label: string;
  usedPct: number | null;
}) {
  const remaining = usedPct === null ? null : remainingPct(usedPct);

  return (
    <>
      <span className="text-xs text-faint">{label}</span>
      {remaining === null ? (
        <span className={cn(TRACK_CLASS, "w-full")} aria-hidden="true" />
      ) : (
        <span
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={remaining}
          className={cn(TRACK_CLASS, "w-full")}
        >
          <span
            className={cn(
              "block h-full rounded-full",
              remaining < LOW_QUOTA_PCT ? "bg-warning" : "bg-success",
            )}
            style={{ width: `${remaining}%` }}
          />
        </span>
      )}
      <span className="font-mono text-[13px] whitespace-nowrap">
        {remaining === null ? "—" : `${remaining} / 100`}
      </span>
    </>
  );
}

// The scheme stays in the tooltip; the row only has room for host:port.
function proxyHost(server: string) {
  return server.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
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
        <span className="mb-1.5 block text-xs font-medium text-faint tablet:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  );
}

function Caption({
  className,
  title,
  children,
}: {
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <p className={cn("mt-1 text-xs text-faint", className)} title={title}>
      {children}
    </p>
  );
}
