import { Check, LoaderCircle } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { isTaskActive, taskErrorKey } from "@/features/tasks/lib/task-format";
import { ApiError } from "@/lib/http";
import { useMusicGeneration } from "../hooks/use-music-generation";
import type { Project } from "../types";

const REQUEST_ERRORS = [
  "generation_active",
  "account_unavailable",
  "too_many_files",
  "project_not_found",
] as const;

function requestErrorKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = REQUEST_ERRORS.find((value) => value === code);
  return known
    ? (`projects.music.errors.${known}` as const)
    : "projects.music.errors.unknown";
}

// Asks Muse for a short piece of background music. Mount it only while open.
export function MuseMusicDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const { query, request } = useMusicGeneration(project.id);
  // Starts from the music the project's brief asks for.
  const [description, setDescription] = useState(project.music);
  const task = query.data;
  const active = task ? isTaskActive(task) : false;
  // What happened to a request made while this dialog is open.
  const asked = request.isSuccess;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="border border-input p-6 sm:max-w-md">
        <DialogHeader className="pr-6">
          <DialogTitle className="text-lg font-semibold">
            {t("projects.music.title")}
          </DialogTitle>
          <DialogDescription>
            {t("projects.music.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`${id}-description`}>
            {t("projects.music.prompt")}
          </Label>
          <Textarea
            id={`${id}-description`}
            rows={3}
            maxLength={500}
            value={description}
            disabled={active || request.isPending}
            placeholder={t("projects.form.musicPlaceholder")}
            onChange={(event) => setDescription(event.target.value)}
            className="min-h-20 resize-y"
          />
          <p className="text-xs leading-5 text-faint">
            {t("projects.music.cost")}
          </p>
        </div>
        <div role="status" aria-live="polite" className="text-[13px]">
          {active && (
            <p className="flex items-center gap-2 text-running">
              <LoaderCircle
                className="size-4 shrink-0 motion-safe:animate-spin motion-reduce:animate-pulse"
                aria-hidden="true"
              />
              {t("projects.music.working")}
            </p>
          )}
          {asked && task?.status === "succeeded" && (
            <p className="flex items-center gap-2 text-success">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {t("projects.music.done")}
            </p>
          )}
          {asked && task?.status === "failed" && (
            <p className="text-destructive">
              {t(taskErrorKey(task.error?.code))}
            </p>
          )}
        </div>
        {request.isError && (
          <p role="alert" className="text-[13px] text-destructive">
            {t(requestErrorKey(request.error))}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button
            type="button"
            disabled={active || request.isPending || !description.trim()}
            onClick={() =>
              request.mutate({
                projectId: project.id,
                description: description.trim(),
              })
            }
          >
            {t(
              active || request.isPending
                ? "projects.music.working"
                : "projects.music.action",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
