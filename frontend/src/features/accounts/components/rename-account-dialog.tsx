import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
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
import { usePatchAccount } from "../hooks/use-account-queries";
import { accountLabelSchema } from "../schemas";
import type { Account } from "../types";

export function RenameAccountDialog({ account }: { account: Account }) {
  const { t } = useTranslation();
  const id = useId();
  const [open, setOpen] = useState(false);
  const mutation = usePatchAccount();
  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<{ label: string }>({
    resolver: zodResolver(accountLabelSchema),
    defaultValues: { label: account.label },
  });

  function onOpenChange(next: boolean) {
    if (isSubmitting) return;
    reset({ label: account.label });
    mutation.reset();
    setOpen(next);
  }

  async function submit(values: { label: string }) {
    try {
      await mutation.mutateAsync({ id: account.id, values });
      setOpen(false);
    } catch {
      // Preserve the edited label on a failed save.
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("accounts.rename.forAccount", { label: account.label })}
        >
          <Pencil aria-hidden="true" />
        </Button>
      </DialogTrigger>
      {open && (
        <DialogContent showCloseButton={!isSubmitting} className="p-6">
          <DialogHeader className="pr-6">
            <DialogTitle>{t("accounts.rename.title")}</DialogTitle>
            <DialogDescription>
              {t("accounts.rename.description")}
            </DialogDescription>
          </DialogHeader>
          <form
            noValidate
            onSubmit={handleSubmit(submit)}
            className="space-y-4"
          >
            <Label htmlFor={id}>{t("accounts.fields.label")}</Label>
            <Input
              {...register("label")}
              id={id}
              maxLength={100}
              disabled={isSubmitting}
              aria-invalid={Boolean(errors.label)}
            />
            {errors.label && (
              <p role="alert" className="text-xs text-destructive">
                {t("accounts.errors.label")}
              </p>
            )}
            {mutation.isError && (
              <p role="alert" className="text-xs text-destructive">
                {t("accounts.errors.update")}
              </p>
            )}
            <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
              <Button
                type="button"
                variant="outline"
                disabled={isSubmitting}
                onClick={() => onOpenChange(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {t(
                  isSubmitting
                    ? "accounts.rename.saving"
                    : "accounts.rename.save",
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
