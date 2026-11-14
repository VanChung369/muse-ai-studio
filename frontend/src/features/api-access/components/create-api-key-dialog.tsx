import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, LoaderCircle, Plus } from "lucide-react";
import { useId, useRef, useState } from "react";
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
import { API_KEY_NAME_MAX_LENGTH } from "../constants";
import { useCreateApiKey } from "../hooks/use-api-keys";
import { useCopyClipboard } from "../hooks/use-copy-clipboard";
import { createKeyErrorKey } from "../lib/api-key-errors";
import { createApiKeyFormSchema } from "../schemas";
import type { CreateApiKeyInput } from "../types";
import { CopyButton } from "./copy-button";

const defaultValues: CreateApiKeyInput = { name: "" };

export function CreateApiKeyDialog({
  disabled = false,
  onCreated,
}: {
  disabled?: boolean;
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <Plus aria-hidden="true" />
          {t("apiAccess.keys.createAction")}
        </Button>
      </DialogTrigger>
      {open && (
        <CreateApiKeyContent
          onClose={() => setOpen(false)}
          onPendingChange={setPending}
          onCreated={onCreated}
        />
      )}
    </Dialog>
  );
}

// Mount a fresh component per open so the full key in component state is
// always dropped when the dialog closes.
function CreateApiKeyContent({
  onClose,
  onPendingChange,
  onCreated,
}: {
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
  onCreated: (name: string) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const request = useCreateApiKey();
  const clipboard = useCopyClipboard();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [createdName, setCreatedName] = useState("");
  const keyInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    reset,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateApiKeyInput>({
    resolver: zodResolver(createApiKeyFormSchema),
    defaultValues,
  });

  async function submit(values: CreateApiKeyInput) {
    onPendingChange(true);
    try {
      const created = await request.submit(values);
      reset(defaultValues);
      setCreatedKey(created.key);
      setCreatedName(created.name);
      onCreated(created.name);
    } catch {
      // Keep the dialog open and surface localized error feedback.
    } finally {
      onPendingChange(false);
    }
  }

  async function handleCopyCreated() {
    if (!createdKey) return;
    const ok = await clipboard.copy(createdKey);
    if (!ok) {
      keyInputRef.current?.focus();
      keyInputRef.current?.select();
    }
  }

  if (createdKey !== null) {
    return (
      <DialogContent className="p-6 sm:max-w-lg">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="size-4 text-primary" aria-hidden="true" />
            {t("apiAccess.create.createdTitle")}
          </DialogTitle>
          <DialogDescription className="leading-6">
            {t("apiAccess.create.createdDescription", { name: createdName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`${id}-created-key`}>
              {t("apiAccess.create.keyLabel")}
            </Label>
            <div className="flex gap-2">
              <Input
                ref={keyInputRef}
                id={`${id}-created-key`}
                type="text"
                readOnly
                value={createdKey}
                onFocus={(event) => event.currentTarget.select()}
                className="h-9 flex-1 font-mono text-xs max-tablet:h-11"
              />
              <CopyButton
                copied={clipboard.copied}
                onCopy={() => void handleCopyCreated()}
                size="default"
              />
            </div>
            {clipboard.failedText !== null && (
              <p role="alert" className="text-xs leading-5 text-warning">
                {t("apiAccess.clipboard.failed")}
              </p>
            )}
          </div>
          <p className="rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs leading-5 text-warning">
            {t("apiAccess.create.keepSafeNote")}
          </p>
        </div>

        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button type="button" onClick={onClose}>
            {t("apiAccess.create.done")}
          </Button>
        </DialogFooter>
      </DialogContent>
    );
  }

  return (
    <DialogContent
      showCloseButton={!isSubmitting}
      className="p-6 sm:max-w-md"
      onEscapeKeyDown={(event) => {
        if (isSubmitting) event.preventDefault();
      }}
      onInteractOutside={(event) => {
        if (isSubmitting) event.preventDefault();
      }}
    >
      <DialogHeader className="pr-6">
        <DialogTitle>{t("apiAccess.create.title")}</DialogTitle>
        <DialogDescription className="leading-6">
          {t("apiAccess.create.description")}
        </DialogDescription>
      </DialogHeader>

      <form noValidate onSubmit={handleSubmit(submit)} className="space-y-5">
        <fieldset disabled={isSubmitting} className="min-w-0 space-y-2">
          <Label htmlFor={`${id}-name`}>
            {t("apiAccess.create.nameLabel")}
          </Label>
          <Input
            {...register("name")}
            id={`${id}-name`}
            autoComplete="off"
            autoFocus
            maxLength={API_KEY_NAME_MAX_LENGTH}
            placeholder={t("apiAccess.create.namePlaceholder")}
            className="h-9 max-tablet:h-11"
            aria-invalid={Boolean(errors.name)}
            aria-describedby={`${id}-name-hint`}
          />
          <p id={`${id}-name-hint`} className="text-xs text-faint">
            {t("apiAccess.create.nameHint", { max: API_KEY_NAME_MAX_LENGTH })}
          </p>
          {errors.name && (
            <p role="alert" className="text-xs text-destructive">
              {t("apiAccess.errors.invalidName")}
            </p>
          )}
        </fieldset>

        {request.error !== null && (
          <p role="alert" className="text-sm leading-5 text-destructive">
            {t(createKeyErrorKey(request.error))}
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
            {isSubmitting && (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            )}
            {t(
              isSubmitting
                ? "apiAccess.create.creating"
                : "apiAccess.keys.createAction",
            )}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
