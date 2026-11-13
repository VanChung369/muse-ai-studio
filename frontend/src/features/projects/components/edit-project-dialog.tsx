import { zodResolver } from "@hookform/resolvers/zod";
import { useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/http";
import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_CONTINUITIES,
  PROJECT_LOOKS,
  PROJECT_UPDATE_ERROR_CODES,
} from "../constants";
import { useUpdateProject } from "../hooks/use-project-queries";
import { isScriptEditable } from "../lib/project-script";
import { projectSettingsSchema } from "../schemas";
import type { Project, ProjectSettings } from "../types";

const BRIEF_FIELDS = [
  "name",
  "idea",
  "aspectRatio",
  "durationSeconds",
] as const;
const OPTION_FIELDS = ["look", "continuity"] as const;
const SELECT_TRIGGER =
  "w-full data-[size=default]:h-9 data-[size=default]:max-tablet:h-11";

function errorKey(error: unknown) {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = PROJECT_UPDATE_ERROR_CODES.find((value) => value === code);
  return known
    ? (`projects.settings.errors.${known}` as const)
    : "projects.settings.errors.unknown";
}

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
  const id = useId();
  const mutation = useUpdateProject();
  const [discardScript, setDiscardScript] = useState(false);
  // Mirrors the server: the brief is fixed once a render has started.
  const briefLocked = !isScriptEditable(project.status);
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<ProjectSettings>({
    resolver: zodResolver(projectSettingsSchema),
    defaultValues: {
      name: project.name,
      idea: project.idea,
      aspectRatio: project.aspectRatio,
      durationSeconds: project.durationSeconds,
      look: project.look,
      continuity: project.continuity,
    },
  });
  const [look, continuity, durationSeconds] = useWatch({
    control,
    name: ["look", "continuity", "durationSeconds"],
  });
  const pending = mutation.isPending;
  // A saved script adds up to the current duration.
  const needsDiscard =
    !briefLocked &&
    project.sceneCount > 0 &&
    durationSeconds !== project.durationSeconds;

  function submit(values: ProjectSettings) {
    const fields = briefLocked
      ? OPTION_FIELDS
      : [...BRIEF_FIELDS, ...OPTION_FIELDS];
    const changed = Object.fromEntries(
      fields
        .filter((field) => values[field] !== project[field])
        .map((field) => [field, values[field]]),
    ) as Partial<ProjectSettings>;
    if (Object.keys(changed).length === 0) return onClose();
    mutation.mutate(
      {
        id: project.id,
        values: needsDiscard ? { ...changed, discardScript: true } : changed,
      },
      { onSuccess: onClose },
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !pending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!pending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto border border-input p-6 sm:max-w-lg"
      >
        <DialogHeader className="pr-6">
          <DialogTitle className="text-lg font-semibold">
            {t("projects.settings.title")}
          </DialogTitle>
          <DialogDescription>
            {t(
              briefLocked
                ? "projects.settings.lockedBrief"
                : "projects.settings.description",
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={handleSubmit(submit)}
          className="mt-2 space-y-5"
        >
          {mutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {t(errorKey(mutation.error))}
            </p>
          )}
          <fieldset disabled={pending || briefLocked} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>{t("projects.form.name")}</Label>
              <Input
                {...register("name")}
                id={`${id}-name`}
                maxLength={100}
                autoComplete="off"
                aria-invalid={Boolean(errors.name)}
                className="h-9 max-tablet:h-11"
              />
              {errors.name && (
                <p role="alert" className="text-xs text-destructive">
                  {t("projects.form.errors.name")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-idea`}>{t("projects.form.idea")}</Label>
              <Textarea
                {...register("idea")}
                id={`${id}-idea`}
                rows={3}
                maxLength={12000}
                aria-invalid={Boolean(errors.idea)}
                className="min-h-20 resize-y"
              />
              {errors.idea && (
                <p role="alert" className="text-xs text-destructive">
                  {t("projects.form.errors.idea")}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${id}-duration`}>
                  {t("projects.form.duration")}
                </Label>
                <Input
                  {...register("durationSeconds", { valueAsNumber: true })}
                  id={`${id}-duration`}
                  type="number"
                  min={10}
                  max={300}
                  step={5}
                  aria-invalid={Boolean(errors.durationSeconds)}
                  aria-describedby={`${id}-duration-hint`}
                  className="h-9 max-tablet:h-11"
                />
                <p
                  id={`${id}-duration-hint`}
                  role={errors.durationSeconds ? "alert" : undefined}
                  className={
                    errors.durationSeconds
                      ? "text-xs text-destructive"
                      : "text-xs text-faint"
                  }
                >
                  {errors.durationSeconds
                    ? t("projects.form.errors.durationSeconds")
                    : project.sceneCount > 0
                      ? t("projects.settings.durationWithScript", {
                          seconds: project.durationSeconds,
                        })
                      : t("projects.form.durationHint")}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-ratio`}>
                  {t("projects.form.ratio")}
                </Label>
                <Controller
                  name="aspectRatio"
                  control={control}
                  render={({ field }) => (
                    <Select
                      disabled={pending || briefLocked}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        id={`${id}-ratio`}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        className={SELECT_TRIGGER}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectGroup>
                          {PROJECT_ASPECT_RATIOS.map((ratio) => (
                            <SelectItem key={ratio} value={ratio}>
                              {ratio}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>
            {needsDiscard && (
              <label className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs leading-5 text-warning">
                <input
                  type="checkbox"
                  checked={discardScript}
                  onChange={(event) => setDiscardScript(event.target.checked)}
                  className="mt-0.5 size-4 shrink-0 accent-primary"
                />
                {t("projects.settings.discardScript")}
              </label>
            )}
          </fieldset>
          <fieldset disabled={pending} className="space-y-5 border-t pt-5">
            <legend className="sr-only">
              {t("projects.settings.renderOptions")}
            </legend>
            <p className="text-sm font-semibold" aria-hidden="true">
              {t("projects.settings.renderOptions")}
            </p>
            <div className="space-y-2">
              <Label htmlFor={`${id}-look`}>
                {t("projects.settings.look")}
              </Label>
              <Controller
                name="look"
                control={control}
                render={({ field }) => (
                  <Select
                    disabled={pending}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id={`${id}-look`}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      aria-describedby={`${id}-look-hint`}
                      className={SELECT_TRIGGER}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {PROJECT_LOOKS.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`projects.settings.looks.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <p
                id={`${id}-look-hint`}
                className="text-xs leading-5 text-faint"
              >
                {t(`projects.settings.lookHints.${look}`)}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-continuity`}>
                {t("projects.settings.continuity")}
              </Label>
              <Controller
                name="continuity"
                control={control}
                render={({ field }) => (
                  <Select
                    disabled={pending}
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <SelectTrigger
                      id={`${id}-continuity`}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      aria-describedby={`${id}-continuity-hint`}
                      className={SELECT_TRIGGER}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        {PROJECT_CONTINUITIES.map((value) => (
                          <SelectItem key={value} value={value}>
                            {t(`projects.settings.continuities.${value}`)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                )}
              />
              <p
                id={`${id}-continuity-hint`}
                className="text-xs leading-5 text-faint"
              >
                {t(`projects.settings.continuityHints.${continuity}`)}
              </p>
            </div>
          </fieldset>
          <DialogFooter className="mt-6 -mr-6 -mb-6 -ml-6 rounded-b-xl px-6 py-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={pending || (needsDiscard && !discardScript)}
            >
              {t(
                pending ? "projects.settings.saving" : "projects.settings.save",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
