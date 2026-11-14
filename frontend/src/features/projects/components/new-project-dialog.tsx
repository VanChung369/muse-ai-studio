import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import {
  Controller,
  type FieldErrors,
  useForm,
  useWatch,
} from "react-hook-form";
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
import { cn } from "@/lib/utils";
import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_LONG_SECONDS,
  PROJECT_MAX_SECONDS,
  PROJECT_LANGUAGES,
  PROJECT_LOOKS,
  REFERENCE_MAX_FILES,
} from "../constants";
import { projectCreateSchema } from "../schemas";
import { useSettingsQuery } from "@/features/settings/hooks/use-settings";
import type { ProjectCreateDraft } from "../types";
import {
  type ReferenceErrorCode,
  ReferenceFilePicker,
} from "./reference-manager";

const SELECT_TRIGGER =
  "w-full data-[size=default]:h-9 data-[size=default]:max-tablet:h-11";

const defaultValues: ProjectCreateDraft = {
  name: "",
  idea: "",
  durationSeconds: 60,
  aspectRatio: "16:9",
  characterBible: "",
  visualStyle: "",
  music: "",
  look: "auto",
  language: "auto",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: ProjectCreateDraft, files: File[]) => Promise<void>;
  hasError: boolean;
};

export function NewProjectDialog({
  open,
  onOpenChange,
  onCreate,
  hasError,
}: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [moreOpen, setMoreOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<ReferenceErrorCode | null>(null);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<ProjectCreateDraft>({
    resolver: zodResolver(projectCreateSchema),
    defaultValues,
  });
  const look = useWatch({ control, name: "look" });
  const durationSeconds = useWatch({ control, name: "durationSeconds" });

  // The defaults saved in Settings, once they are known.
  const saved = useSettingsQuery().data?.projectDefaults;
  const startValues = (): ProjectCreateDraft =>
    saved
      ? {
          ...defaultValues,
          durationSeconds: saved.durationSeconds,
          aspectRatio: saved.aspectRatio,
          look: saved.look,
          language: saved.language,
        }
      : defaultValues;

  function resetAll() {
    reset(startValues());
    setFiles([]);
    setFileError(null);
    setMoreOpen(false);
  }

  // Reset on every close (submit, Cancel, Esc, overlay) so the next open
  // starts clean instead of showing stale values and errors.
  function handleOpenChange(next: boolean) {
    if (isSubmitting) return;
    // Opening also starts from the saved defaults: they may have arrived,
    // or changed, since the form was last reset.
    resetAll();
    onOpenChange(next);
  }

  async function submit(values: ProjectCreateDraft) {
    try {
      await onCreate(values, files);
      resetAll();
    } catch {
      // The mutation exposes the error; keep the form values for a retry.
    }
  }

  function handleInvalid(fieldErrors: FieldErrors<ProjectCreateDraft>) {
    if (
      fieldErrors.language ||
      fieldErrors.look ||
      fieldErrors.characterBible ||
      fieldErrors.visualStyle ||
      fieldErrors.music
    ) {
      setMoreOpen(true);
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
      <DialogContent
        showCloseButton={!isSubmitting}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto border border-input p-6 sm:max-w-[min(48rem,calc(100%-2rem))]"
      >
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
          onSubmit={handleSubmit(submit, handleInvalid)}
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
                  max={PROJECT_MAX_SECONDS}
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
                {Number.isFinite(durationSeconds) &&
                  durationSeconds > PROJECT_LONG_SECONDS &&
                  durationSeconds <= PROJECT_MAX_SECONDS && (
                    <p
                      role="status"
                      className="rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-xs leading-5 text-warning"
                    >
                      {t("projects.form.durationLong", {
                        scenes: Math.ceil(durationSeconds / 10),
                      })}
                    </p>
                  )}
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
                      disabled={isSubmitting}
                      value={field.value}
                      onValueChange={field.onChange}
                    >
                      <SelectTrigger
                        id={`${id}-ratio`}
                        ref={field.ref}
                        onBlur={field.onBlur}
                        aria-invalid={Boolean(errors.aspectRatio)}
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
                {errors.aspectRatio && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("projects.form.errors.aspectRatio")}
                  </p>
                )}
              </div>
            </div>
            <div className="border-t pt-4">
              <button
                type="button"
                aria-expanded={moreOpen}
                aria-controls={`${id}-more`}
                onClick={() => setMoreOpen((previous) => !previous)}
                className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                <span>{t("projects.form.more")}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "size-4 shrink-0 transition-transform motion-reduce:transition-none",
                    moreOpen && "rotate-180",
                  )}
                />
              </button>
              <div
                id={`${id}-more`}
                className={moreOpen ? "mt-4 space-y-5" : "hidden"}
              >
                <div className="space-y-2">
                  <Label htmlFor={`${id}-language`}>
                    {t("projects.settings.language")}
                  </Label>
                  <Controller
                    name="language"
                    control={control}
                    render={({ field }) => (
                      <Select
                        disabled={isSubmitting}
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          id={`${id}-language`}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          aria-describedby={`${id}-language-hint`}
                          className={SELECT_TRIGGER}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          <SelectGroup>
                            {PROJECT_LANGUAGES.map((value) => (
                              <SelectItem key={value} value={value}>
                                {t(`projects.settings.languages.${value}`)}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <p
                    id={`${id}-language-hint`}
                    className="text-xs leading-5 text-faint"
                  >
                    {t("projects.settings.languageHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-look`}>
                    {t("projects.settings.look")}
                  </Label>
                  <Controller
                    name="look"
                    control={control}
                    render={({ field }) => (
                      <Select
                        disabled={isSubmitting}
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
                  <Label htmlFor={`${id}-characters`}>
                    {t("projects.form.characters")}
                  </Label>
                  <Textarea
                    {...register("characterBible")}
                    id={`${id}-characters`}
                    rows={3}
                    maxLength={10000}
                    placeholder={t("projects.form.charactersPlaceholder")}
                    aria-invalid={Boolean(errors.characterBible)}
                    aria-describedby={`${id}-characters-hint`}
                    className="resize-y"
                  />
                  {errors.characterBible && (
                    <p role="alert" className="text-xs text-destructive">
                      {t("projects.script.errors.characters")}
                    </p>
                  )}
                  <p
                    id={`${id}-characters-hint`}
                    className="text-xs leading-5 text-faint"
                  >
                    {t("projects.form.charactersHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-visual-style`}>
                    {t("projects.form.visualStyle")}
                  </Label>
                  <Textarea
                    {...register("visualStyle")}
                    id={`${id}-visual-style`}
                    rows={2}
                    maxLength={3000}
                    placeholder={t("projects.form.visualStylePlaceholder")}
                    aria-invalid={Boolean(errors.visualStyle)}
                    className="resize-y"
                  />
                  {errors.visualStyle && (
                    <p role="alert" className="text-xs text-destructive">
                      {t("projects.script.errors.style")}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-music`}>
                    {t("projects.form.music")}
                  </Label>
                  <Input
                    {...register("music")}
                    id={`${id}-music`}
                    maxLength={500}
                    placeholder={t("projects.form.musicPlaceholder")}
                    aria-invalid={Boolean(errors.music)}
                    aria-describedby={`${id}-music-hint`}
                    className="h-9 max-tablet:h-11"
                  />
                  <p
                    id={`${id}-music-hint`}
                    className="text-xs leading-5 text-faint"
                  >
                    {t("projects.form.musicHint")}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${id}-references`}>
                    {t("projects.form.references")}
                  </Label>
                  <p className="text-xs leading-5 text-faint">
                    {t("projects.form.referencesHint", {
                      count: REFERENCE_MAX_FILES,
                    })}
                  </p>
                  {files.length > 0 && (
                    <ul className="divide-y rounded-lg border bg-card">
                      {files.map((file, index) => (
                        <li
                          key={`${file.name}-${file.size}-${index}`}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-xs"
                        >
                          <span className="min-w-0 truncate" title={file.name}>
                            {file.name}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 text-faint">
                            <span className="font-mono">
                              {formatFileSize(file.size)}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-xs"
                              disabled={isSubmitting}
                              onClick={() => {
                                setFileError(null);
                                setFiles((previous) =>
                                  previous.filter((_, i) => i !== index),
                                );
                              }}
                              aria-label={t("projects.form.removeReference", {
                                name: file.name,
                              })}
                            >
                              <X aria-hidden="true" />
                            </Button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {fileError && (
                    <p role="alert" className="text-xs text-destructive">
                      {t(`projects.form.referenceErrors.${fileError}`)}
                    </p>
                  )}
                  <ReferenceFilePicker
                    id={`${id}-references`}
                    existingCount={files.length}
                    disabled={isSubmitting}
                    onSelect={(accepted, errorCode) => {
                      setFileError(errorCode);
                      if (accepted.length > 0)
                        setFiles((previous) => [...previous, ...accepted]);
                    }}
                  />
                </div>
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
              {t(
                isSubmitting ? "projects.form.saving" : "projects.form.submit",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
