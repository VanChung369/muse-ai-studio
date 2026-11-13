import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { Project } from "../types";
import { settingsNoteKey } from "../lib/project-script";
import { ProjectSettingsForm } from "./project-settings-form";

// Edits the project's brief (until a render starts) and its render options.
// Mount it only while open, so each opening starts from the saved project.
export function EditProjectDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto border border-input p-6 sm:max-w-[min(48rem,calc(100%-2rem))]"
      >
        <DialogHeader className="pr-6">
          <DialogTitle className="text-lg font-semibold">
            {t("projects.settings.title")}
          </DialogTitle>
          <DialogDescription>
            {t(settingsNoteKey(project.status))}
          </DialogDescription>
        </DialogHeader>
        <ProjectSettingsForm
          project={project}
          onSaved={onClose}
          onCancel={onClose}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}
