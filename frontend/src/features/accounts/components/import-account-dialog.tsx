import { zodResolver } from "@hookform/resolvers/zod";
import { Upload } from "lucide-react";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useImportAccount } from "../hooks/use-account-queries";
import { accountErrorKey } from "../lib/account-errors";
import { CookieTextarea } from "./cookie-textarea";
import { accountImportSchema } from "../schemas";
import type { AccountImport } from "../types";

const defaultValues: AccountImport = { label: "", cookieText: "" };

export function ImportAccountDialog({ onImported }: { onImported: (label: string) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button><Upload aria-hidden="true" />{t("accounts.import.action")}</Button>
      </DialogTrigger>
      {open && <ImportAccountContent
        onImported={onImported}
        onClose={() => setOpen(false)}
        onPendingChange={setPending}
      />}
    </Dialog>
  );
}

// Mount a fresh form for each open. Unmounting also releases its credential
// values; uncontrolled fields must not be reused across import sessions.
function ImportAccountContent({ onImported, onClose, onPendingChange }: {
  onImported: (label: string) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const request = useImportAccount();
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccountImport>({
    resolver: zodResolver(accountImportSchema),
    defaultValues,
  });

  async function submit(values: AccountImport) {
    onPendingChange(true);
    try {
      const account = await request.submit(values);
      reset(defaultValues);
      onClose();
      onImported(account.label);
    } catch {
      // Keep form-local input for correction; no credentials enter storage.
    } finally {
      onPendingChange(false);
    }
  }

  return (
      <DialogContent
        showCloseButton={!isSubmitting}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-xl"
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t("accounts.import.title")}</DialogTitle>
          <DialogDescription>
            {t("accounts.import.description")}
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit(submit)} className="space-y-5">
          <fieldset disabled={isSubmitting} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={`${id}-label`}>
                {t("accounts.fields.label")}
              </Label>
              <Input
                {...register("label")}
                id={`${id}-label`}
                autoComplete="off"
                maxLength={100}
                className="h-9 max-tablet:h-11"
                placeholder={t("accounts.import.labelPlaceholder")}
                aria-invalid={Boolean(errors.label)}
              />
              {errors.label && (
                <p role="alert" className="text-xs text-destructive">
                  {t("accounts.errors.label")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-cookies`}>
                {t("accounts.import.cookies")}
              </Label>
              <CookieTextarea
                {...register("cookieText")}
                id={`${id}-cookies`}
                placeholder={t("accounts.import.cookiePlaceholder")}
                aria-invalid={Boolean(errors.cookieText)}
                aria-describedby={`${id}-hint`}
              />
              <p id={`${id}-hint`} className="text-xs leading-5 text-faint">
                {t("accounts.import.cookieHint")}
              </p>
              {errors.cookieText && (
                <p role="alert" className="text-xs text-destructive">
                  {t("accounts.errors.cookies")}
                </p>
              )}
            </div>
          </fieldset>
          {request.error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t(
                accountErrorKey(request.error, {
                  unknown: "accounts.errors.import",
                  rejected: "accounts.errors.rejected",
                }),
              )}
            </p>
          )}
          <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {t(
                isSubmitting
                  ? "accounts.import.importing"
                  : "accounts.import.action",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
  );
}
