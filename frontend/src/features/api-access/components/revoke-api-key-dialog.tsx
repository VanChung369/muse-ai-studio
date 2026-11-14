import { LoaderCircle, Trash2 } from "lucide-react";
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
import { useRevokeApiKey } from "../hooks/use-api-keys";
import { revokeKeyErrorKey } from "../lib/api-key-errors";
import type { ApiKey } from "../types";

export function RevokeApiKeyDialog({
  apiKey,
  onRevoked,
}: {
  apiKey: ApiKey;
  onRevoked: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const mutation = useRevokeApiKey();
  const revokedRef = useRef(false);

  function handleOpenChange(next: boolean) {
    if (mutation.isPending) return;
    mutation.reset();
    setOpen(next);
  }

  async function confirm() {
    if (mutation.isPending) return;
    try {
      await mutation.mutateAsync(apiKey.id);
      revokedRef.current = true;
      setOpen(false);
      onRevoked(apiKey.name);
    } catch {
      // Keep the confirmation open for retry.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:bg-destructive-soft hover:text-destructive"
          aria-label={t("apiAccess.revoke.forKey", { name: apiKey.name })}
        >
          <Trash2 aria-hidden="true" />
          {t("apiAccess.revoke.action")}
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!mutation.isPending}
        className="p-6 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (mutation.isPending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (revokedRef.current) {
            document.getElementById("main-content")?.focus();
          } else if (triggerRef.current?.isConnected) {
            triggerRef.current.focus();
          } else {
            document.getElementById("main-content")?.focus();
          }
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t("apiAccess.revoke.title")}</DialogTitle>
          <DialogDescription className="leading-6 wrap-break-word">
            {t("apiAccess.revoke.description", {
              name: apiKey.name,
              masked: apiKey.masked,
            })}
          </DialogDescription>
        </DialogHeader>

        <p className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-xs leading-5 text-destructive">
          {t("apiAccess.revoke.warning")}
        </p>

        {mutation.isError && (
          <p role="alert" className="text-sm text-destructive">
            {t(revokeKeyErrorKey(mutation.error))}
          </p>
        )}

        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button
            ref={cancelRef}
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={() => handleOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={mutation.isPending}
            onClick={() => void confirm()}
          >
            {mutation.isPending && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {t(
              mutation.isPending
                ? "apiAccess.revoke.revoking"
                : "apiAccess.revoke.confirm",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
