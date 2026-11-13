import { Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/http";
import { useDeleteProject } from "../hooks/use-project-queries";
import { isProjectDeletable } from "../lib/project-list";
import type { ProjectSummary } from "../types";

type Props = {
  project: ProjectSummary;
  compact?: boolean;
  onDeleted: (id: string, name: string) => void;
};

export function DeleteProjectDialog({ project, compact = false, onDeleted }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const mutation = useDeleteProject();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const canDelete = isProjectDeletable(project.status);
  const isBusyError = mutation.error instanceof ApiError && mutation.error.code === "project_busy";

  function handleOpenChange(next: boolean) {
    if (mutation.isPending) return;
    mutation.reset();
    setOpen(next);
  }

  async function confirmDelete() {
    if (mutation.isPending || !canDelete) return;
    try {
      await mutation.mutateAsync(project.id);
      setOpen(false);
      onDeleted(project.id, project.name);
    } catch {
      // Keep the dialog open so the user can cancel or retry the request.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          variant={compact ? "ghost" : "destructive"}
          size={compact ? "icon" : "default"}
          className={compact ? "absolute top-4 right-4 bg-card/90 hover:text-destructive" : undefined}
          disabled={!canDelete}
          title={t(canDelete ? "projects.delete.label" : "projects.delete.busy")}
          aria-label={t("projects.delete.forProject", { name: project.name })}
        >
          <Trash2 aria-hidden="true" />
          <span className={compact ? "sr-only" : undefined}>{t("projects.delete.label")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton={!mutation.isPending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-md"
        onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (triggerRef.current?.isConnected) triggerRef.current.focus();
          else document.getElementById("main-content")?.focus();
        }}
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t("projects.delete.title")}</DialogTitle>
          <DialogDescription className="leading-6 wrap-break-word">
            {t("projects.delete.description", { name: project.name })}
          </DialogDescription>
        </DialogHeader>
        {(mutation.isError || !canDelete) && <p role="alert" className="text-sm text-destructive">
          {t(isBusyError || !canDelete ? "projects.delete.busy" : "projects.delete.error")}
        </p>}
        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button ref={cancelRef} type="button" variant="outline" disabled={mutation.isPending} onClick={() => handleOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button type="button" variant="danger" disabled={mutation.isPending || !canDelete} onClick={() => void confirmDelete()}>
            {t(mutation.isPending ? "projects.delete.deleting" : "projects.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
