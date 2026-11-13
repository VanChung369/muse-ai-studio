import { zodResolver } from "@hookform/resolvers/zod";
import { Plus } from "lucide-react";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
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
  DialogTrigger,
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
import { PROJECT_ASPECT_RATIOS } from "../constants";
import { projectDraftSchema } from "../schemas";
import type { ProjectDraft } from "../types";

const defaultValues: ProjectDraft = {
  name: "",
  idea: "",
  durationSeconds: 60,
  aspectRatio: "16:9",
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: ProjectDraft) => Promise<void>;
  hasError: boolean;
};

export function NewProjectDialog({ open, onOpenChange, onCreate, hasError }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectDraft>({
    resolver: zodResolver(projectDraftSchema),
    defaultValues,
  });

  // Reset on every close (submit, Cancel, Esc, overlay) so the next open
  // starts clean instead of showing stale values and errors.
  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    if (!next) reset(defaultValues);
    onOpenChange(next);
  }

  async function submit(values: ProjectDraft) {
    try {
      await onCreate(values);
      reset(defaultValues);
    } catch {
      // The mutation exposes the error; keep the form values for a retry.
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus aria-hidden="true" />
          {t("projects.newProject")}
        </Button>
      </DialogTrigger>
      <DialogContent showCloseButton={!isSubmitting} className="max-h-[calc(100svh-2rem)] overflow-y-auto border border-input p-6 sm:max-w-lg">
        <DialogHeader className="pr-6">
          <DialogTitle className="text-lg font-semibold">
            {t("projects.form.title")}
          </DialogTitle>
          <DialogDescription>
            {t("projects.form.description")}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={handleSubmit(submit)}
          className="mt-2 space-y-5"
        >
          {hasError && (
            <p role="alert" className="text-sm text-destructive">
              {t("projects.form.saveError")}
            </p>
          )}
          <fieldset disabled={isSubmitting} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={`${id}-name`}>{t("projects.form.name")}</Label>
              <Input
                {...register("name")}
                id={`${id}-name`}
                placeholder={t("projects.form.namePlaceholder")}
                maxLength={100}
                autoComplete="off"
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? `${id}-name-error` : undefined}
                className="h-9 max-tablet:h-11"
              />
              {errors.name && (
                <p
                  id={`${id}-name-error`}
                  role="alert"
                  className="text-xs text-destructive"
                >
                  {t("projects.form.errors.name")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-idea`}>
                {t("projects.form.idea")}
                <span className="font-normal text-faint">
                  {t("projects.form.optional")}
                </span>
              </Label>
              <Textarea
                {...register("idea")}
                id={`${id}-idea`}
                placeholder={t("projects.form.ideaPlaceholder")}
                rows={4}
                maxLength={12000}
                aria-invalid={Boolean(errors.idea)}
                aria-describedby={errors.idea ? `${id}-idea-error` : undefined}
                className="min-h-28 resize-y"
              />
              {errors.idea && (
                <p
                  id={`${id}-idea-error`}
                  role="alert"
                  className="text-xs text-destructive"
                >
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
                  {t(
                    errors.durationSeconds
                      ? "projects.form.errors.durationSeconds"
                      : "projects.form.durationHint",
                  )}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-ratio`}>{t("projects.form.ratio")}</Label>
                <Controller
                  name="aspectRatio"
                  control={control}
                  render={({ field }) => (
                    <Select disabled={isSubmitting} value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger
                        id={`${id}-ratio`}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        aria-invalid={Boolean(errors.aspectRatio)}
                        className="w-full data-[size=default]:h-9 data-[size=default]:max-tablet:h-11"
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
                {errors.aspectRatio && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("projects.form.errors.aspectRatio")}
                  </p>
                )}
              </div>
            </div>
          </fieldset>
          <DialogFooter className="mt-6 -mr-6 -mb-6 -ml-6 rounded-b-xl px-6 py-4">
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={isSubmitting}>
                {t("common.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting}>
              {t(isSubmitting ? "projects.form.saving" : "projects.form.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
