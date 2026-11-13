import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { accountKeys } from "../api/query-keys";
import { editAccount } from "../api/accounts";
import { accountErrorKey } from "../lib/account-errors";
import { accountEditSchema } from "../schemas";
import { CookieTextarea } from "./cookie-textarea";
import type { Account, AccountEditMode, AccountEditValues } from "../types";

export function AccountEditDialog({
  account,
  mode,
  onClose,
}: {
  account: Account;
  mode: AccountEditMode;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const client = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<AccountEditValues>({
    resolver: zodResolver(accountEditSchema(mode)),
    defaultValues: {
      label: account.label,
      notes: account.notes,
      cookieText: "",
      server: account.proxy?.server ?? "",
      username: account.proxy?.username ?? "",
      password: "",
    },
  });

  async function submit(values: AccountEditValues) {
    setError(null);
    try {
      // Credentials stay form-local and never become mutation-cache variables.
      await editAccount(account.id, mode, values);
      void client.invalidateQueries({ queryKey: accountKeys.list });
      onClose();
    } catch (error) {
      setError(error);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !isSubmitting) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!isSubmitting}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-xl"
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t(`accounts.edit.${mode}`)}</DialogTitle>
          <DialogDescription>{account.label}</DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={handleSubmit(submit)} className="space-y-5">
          <fieldset disabled={isSubmitting} className="space-y-4">
            {mode === "rename" && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-label`}>
                  {t("accounts.fields.label")}
                </Label>
                <Input
                  {...register("label")}
                  id={`${id}-label`}
                  maxLength={100}
                  className="h-9 max-tablet:h-11"
                  aria-invalid={!!errors.label}
                />
                {errors.label && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("accounts.errors.label")}
                  </p>
                )}
              </div>
            )}
            {mode === "notes" && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-notes`}>
                  {t("accounts.fields.notes")}
                </Label>
                <Textarea
                  {...register("notes")}
                  id={`${id}-notes`}
                  rows={5}
                  maxLength={2000}
                  aria-invalid={!!errors.notes}
                />
              </div>
            )}
            {mode === "cookies" && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-cookies`}>
                  {t("accounts.import.cookies")}
                </Label>
                <CookieTextarea
                  {...register("cookieText")}
                  id={`${id}-cookies`}
                  rows={7}
                  aria-invalid={!!errors.cookieText}
                />
                <p className="text-xs leading-5 text-faint">
                  {t("accounts.import.cookieHint")}
                </p>
                {errors.cookieText && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("accounts.errors.cookies")}
                  </p>
                )}
              </div>
            )}
            {mode === "proxy" && (
              <>
                <p className="text-xs leading-6 text-muted-foreground">
                  {t("accounts.proxy.hint")}
                </p>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-server`}>
                    {t("accounts.proxy.server")}
                  </Label>
                  <Input
                    {...register("server")}
                    id={`${id}-server`}
                    placeholder={t("accounts.proxy.placeholder")}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-username`}>
                    {t("accounts.proxy.username")}
                  </Label>
                  <Input
                    {...register("username")}
                    id={`${id}-username`}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-password`}>
                    {t("accounts.proxy.password")}
                  </Label>
                  <Input
                    {...register("password")}
                    id={`${id}-password`}
                    type="password"
                    autoComplete="new-password"
                  />
                  <p className="text-xs leading-5 text-faint">
                    {t("accounts.proxy.passwordHint")}
                  </p>
                </div>
              </>
            )}
          </fieldset>
          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t(
                accountErrorKey(error, {
                  unknown: "accounts.errors.update",
                  rejected:
                    mode === "proxy"
                      ? "accounts.proxy.error"
                      : "accounts.errors.rejected",
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
              {t(isSubmitting ? "accounts.rename.saving" : "accounts.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
