import { useRef, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children?: ReactNode;
  // The safe choice: closes the dialog and gets the initial focus.
  dismissLabel: string;
  confirmLabel: string;
  pendingLabel: string;
  pending: boolean;
  danger?: boolean;
  error?: string;
  onConfirm: () => void;
};

// Confirmation for a render action with consequences (design board 13).
export function RenderConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  dismissLabel,
  confirmLabel,
  pendingLabel,
  pending,
  danger = false,
  error,
  onConfirm,
}: Props) {
  const dismissRef = useRef<HTMLButtonElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-md"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          dismissRef.current?.focus();
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="leading-6">
            {description}
          </DialogDescription>
        </DialogHeader>
        {children}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button
            ref={dismissRef}
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            {dismissLabel}
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "default"}
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
