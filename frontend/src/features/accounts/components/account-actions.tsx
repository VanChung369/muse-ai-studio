import {
  Ellipsis,
  HeartPulse,
  RefreshCw,
  Gauge,
  Globe,
  Pause,
  Play,
  Pencil,
  Cookie,
  StickyNote,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ApiError } from "@/lib/http";
import {
  useAccountOperation,
  usePatchAccount,
} from "../hooks/use-account-queries";
import { ACCOUNT_OPERATION_CODES } from "../constants";
import type { Account, AccountEditMode } from "../types";
import { AccountEditDialog } from "./account-edit-dialog";
import { DeleteAccountDialog } from "./delete-account-dialog";

export function AccountActions({
  account,
  onDeleted,
}: {
  account: Account;
  onDeleted: (label: string) => void;
}) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AccountEditMode | null>(null);
  const operation = useAccountOperation();
  const patch = usePatchAccount();
  const code =
    operation.error instanceof ApiError
      ? operation.error.code
      : operation.data?.code;
  const knownCode = ACCOUNT_OPERATION_CODES.find((item) => item === code);
  const pending = operation.isPending || patch.isPending;

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              aria-label={t("accounts.actionsFor", { label: account.label })}
            >
              {pending ? (
                <RefreshCw className="animate-spin" aria-hidden="true" />
              ) : (
                <Ellipsis aria-hidden="true" />
              )}
              {t(pending ? "accounts.running" : "accounts.fields.actions")}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={(event) => { if (mode) event.preventDefault(); }}>
            <DropdownMenuItem
              onSelect={() =>
                operation.mutate({ id: account.id, action: "test" })
              }
            >
              <HeartPulse />
              {t("accounts.actions.test")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                operation.mutate({ id: account.id, action: "keep-alive" })
              }
            >
              <RefreshCw />
              {t("accounts.actions.keepAlive")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                operation.mutate({ id: account.id, action: "quota" })
              }
            >
              <Gauge />
              {t("accounts.actions.quota")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 h-px bg-border" />
            <DropdownMenuItem onSelect={() => { operation.reset(); setMode("proxy"); }}>
              <Globe />
              {t("accounts.actions.proxy")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() =>
                patch.mutate({
                  id: account.id,
                  values: { enabled: !account.enabled },
                })
              }
            >
              {account.enabled ? <Pause /> : <Play />}
              {t(account.enabled ? "accounts.disable" : "accounts.enable")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { operation.reset(); setMode("rename"); }}>
              <Pencil />
              {t("accounts.edit.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { operation.reset(); setMode("cookies"); }}>
              <Cookie />
              {t("accounts.edit.cookies")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { operation.reset(); setMode("notes"); }}>
              <StickyNote />
              {t("accounts.edit.notes")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DeleteAccountDialog account={account} onDeleted={onDeleted} disabled={pending} />
      </div>
      {(operation.isError || operation.data) && (
        <p
          role="status"
          className="max-w-full text-right text-xs leading-5 wrap-anywhere text-muted-foreground"
        >
          {knownCode
            ? t(`accounts.operationMessages.${knownCode}`)
            : t("accounts.errors.update")}
        </p>
      )}
      {patch.isError && (
        <p role="alert" className="text-xs text-destructive">
          {t("accounts.errors.update")}
        </p>
      )}
      {mode && (
        <AccountEditDialog
          key={mode}
          account={account}
          mode={mode}
          onClose={() => setMode(null)}
        />
      )}
    </div>
  );
}
