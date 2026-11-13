import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDeleteAccount, useForgetAccount } from "../hooks/use-account-queries";
import type { Account } from "../types";

export function DeleteAccountDialog({
  account,
  onDeleted,
  disabled = false,
}: {
  account: Account;
  onDeleted: (label: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mutation = useDeleteAccount();
  const forgetAccount = useForgetAccount();
  const deleted = useRef(false);

  function onOpenChange(next: boolean) {
    if (mutation.isPending) return;
    mutation.reset();
    setOpen(next);
  }

  async function confirm() {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync(account.id);
      deleted.current = true;
      setOpen(false);
      onDeleted(account.label);
    } catch {
      // Keep the confirmation open for an explicit retry.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          disabled={disabled}
          variant="ghost"
          size="icon"
          className="hover:text-destructive"
          aria-label={t("accounts.delete.forAccount", { label: account.label })}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!mutation.isPending}
        className="p-6 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (deleted.current) {
            // The trigger is about to disappear with its row: move focus to
            // the page first, then remove the row.
            document.getElementById("main-content")?.focus();
            forgetAccount(account.id);
          } else if (triggerRef.current?.isConnected) {
            triggerRef.current.focus();
          } else {
            document.getElementById("main-content")?.focus();
          }
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t("accounts.delete.title")}</DialogTitle>
          <DialogDescription className="leading-6 wrap-break-word">
            {t("accounts.delete.description", { label: account.label })}
          </DialogDescription>
        </DialogHeader>
        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t("accounts.errors.delete")}
          </p>
        )}
        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mutation.isPending}
            onClick={() => void confirm()}
          >
            {t(
              mutation.isPending
                ? "accounts.delete.deleting"
                : "accounts.delete.confirm",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
