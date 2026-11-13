import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useId, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
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
import { formatDuration } from "@/lib/format";
import { ApiError } from "@/lib/http";
import { cn } from "@/lib/utils";
import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_CONTINUITIES,
  PROJECT_LANGUAGES,
  PROJECT_LOOKS,
  PROJECT_UPDATE_ERROR_CODES,
  REFERENCE_MAX_FILES,
} from "../constants";
import { useUpdateProject } from "../hooks/use-project-queries";
import { isRenderActive } from "../lib/project-render";
import { isScriptEditable, settingsNoteKey } from "../lib/project-script";
import { projectSettingsSchema } from "../schemas";
import type { Project, ProjectSettings } from "../types";
import { ReferenceManager } from "./reference-manager";

const BRIEF_FIELDS = [
  "name",
  "idea",
  "characterBible",
  "visualStyle",
  "aspectRatio",
  "durationSeconds",
] as const;
const OPTION_FIELDS = [
  "language",
  "look",
  "continuity",
  "mute",
  "music",
] as const;
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
// What cannot change is disabled, and so is saving while there is nothing new
// to save.
// "stacked" is one column for the dialog; "page" is step 1 of the project at
// full width (design board 11): the brief in the main column, an overview,
// the render options and the save button beside it.
export function ProjectSettingsForm({
  project,
  layout = "stacked",
  onSaved,
  onCancel,
  onPendingChange,
  children,
}: {
  project: Project;
  layout?: "stacked" | "page";
  // Shown under the save button of the page layout.
  children?: React.ReactNode;
  onSaved?: () => void;
  onCancel?: () => void;
  onPendingChange?: (pending: boolean) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const mutation = useUpdateProject();
  const [discardScript, setDiscardScript] = useState(false);
  // Mirrors the server: the brief is fixed once a render has started.
  const briefLocked = !isScriptEditable(project.status);
  // Nothing at all can change while a render runs.
  const busy = isRenderActive(project.status);
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<ProjectSettings>({
    resolver: zodResolver(projectSettingsSchema),
    defaultValues: {
      name: project.name,
      idea: project.idea,
      characterBible: project.characterBible,
      visualStyle: project.visualStyle,
      aspectRatio: project.aspectRatio,
      durationSeconds: project.durationSeconds,
      language: project.language,
      mute: project.mute,
      music: project.music,
      look: project.look,
      continuity: project.continuity,
    },
  });
  const [look, continuity, durationSeconds, aspectRatio, language] = useWatch({
    control,
    name: ["look", "continuity", "durationSeconds", "aspectRatio", "language"],
  });
  const page = layout === "page";
  const pending = mutation.isPending;
  useEffect(() => {
    onPendingChange?.(pending);
  }, [onPendingChange, pending]);

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
    if (Object.keys(changed).length === 0) {
      onSaved?.();
      return;
    }
    mutation.mutate(
      {
        id: project.id,
        values: needsDiscard ? { ...changed, discardScript: true } : changed,
      },
      {
        onSuccess: () => {
          // What was saved is the new starting point: saving is offered
          // again only after another change.
          reset(values);
          setDiscardScript(false);
          onSaved?.();
        },
      },
    );
  }

  const alert = mutation.isError && (
    <p role="alert" className="text-sm text-destructive">
      {t(errorKey(mutation.error))}
    </p>
  );
  const brief = (
    <fieldset
      disabled={pending || briefLocked}
      className={cn(
        "space-y-5",
        // Labels dim with their fields, so a locked part reads as locked.
        briefLocked && "[&_label]:text-muted-foreground",
      )}
    >
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
          rows={page ? 7 : 3}
          maxLength={12000}
          aria-invalid={Boolean(errors.idea)}
          className={cn(
            "resize-y",
            page ? "min-h-40 text-[15px] leading-7" : "min-h-20",
          )}
        />
        {errors.idea && (
          <p role="alert" className="text-xs text-destructive">
            {t("projects.form.errors.idea")}
          </p>
        )}
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
          className="min-h-20 resize-y"
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
          <Label htmlFor={`${id}-ratio`}>{t("projects.form.ratio")}</Label>
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
  );
  const options = (
    <fieldset
      disabled={pending || busy}
      className={cn(
        "space-y-5",
        !page && "border-t pt-5",
        busy && "[&_label]:text-muted-foreground",
      )}
    >
      <legend className="sr-only">
        {t("projects.settings.renderOptions")}
      </legend>
      {!page && (
        <p className="text-sm font-semibold" aria-hidden="true">
          {t("projects.settings.renderOptions")}
        </p>
      )}
      <label className="flex items-start gap-2 text-[13px]">
        <input
          {...register("mute")}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0 accent-primary"
        />
        <span>
          {t("projects.settings.mute")}
          <span className="mt-0.5 block text-xs leading-5 text-faint">
            {t("projects.settings.muteHint")}
          </span>
        </span>
      </label>
      <div className="space-y-2">
        <Label htmlFor={`${id}-music`}>{t("projects.form.music")}</Label>
        <Input
          {...register("music")}
          id={`${id}-music`}
          maxLength={500}
          placeholder={t("projects.form.musicPlaceholder")}
          aria-invalid={Boolean(errors.music)}
          aria-describedby={`${id}-music-hint`}
          className="h-9 max-tablet:h-11"
        />
        <p id={`${id}-music-hint`} className="text-xs leading-5 text-faint">
          {t("projects.form.musicHint")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-language`}>
          {t("projects.settings.language")}
        </Label>
        <Controller
          name="language"
          control={control}
          render={({ field }) => (
            <Select
              disabled={pending || busy}
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
        <p id={`${id}-language-hint`} className="text-xs leading-5 text-faint">
          {t("projects.settings.languageHint")}
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-look`}>{t("projects.settings.look")}</Label>
        <Controller
          name="look"
          control={control}
          render={({ field }) => (
            <Select
              disabled={pending || busy}
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
        <p id={`${id}-look-hint`} className="text-xs leading-5 text-faint">
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
              disabled={pending || busy}
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
  );
  const references = (
    <section className="space-y-3 border-t pt-5">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">
          {t("projects.form.references")}
        </h3>
        <p className="text-xs leading-5 text-faint">
          {t("projects.form.referencesHint", {
            count: REFERENCE_MAX_FILES,
          })}
        </p>
      </div>
      <ReferenceManager project={project} disabled={pending || busy} />
    </section>
  );
  const actions = (
    <div className={cn("flex flex-wrap justify-end gap-2", page && "*:w-full")}>
      {onCancel && (
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
      )}
      <Button
        type="submit"
        form={`${id}-form`}
        disabled={
          pending || busy || !isDirty || (needsDiscard && !discardScript)
        }
      >
        {t(pending ? "projects.settings.saving" : "projects.settings.save")}
      </Button>
    </div>
  );

  if (page)
    return (
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={handleSubmit(submit)}
        className="grid desktop:grid-cols-[minmax(0,1fr)_23rem]"
      >
        <div className="min-w-0 p-4 tablet:p-6">
          <div className="mx-auto max-w-3xl space-y-6">
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">
                {t("projects.workspace.idea.title")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t(
                  briefLocked
                    ? settingsNoteKey(project.status)
                    : "projects.workspace.idea.description",
                )}
              </p>
            </div>
            {alert}
            {brief}
            {references}
          </div>
        </div>
        <aside className="min-w-0 space-y-5 border-t p-5 desktop:border-t-0 desktop:border-l">
          <section className="space-y-4 rounded-lg border bg-card p-4">
            <h3 className="text-[11px] font-semibold tracking-wider text-faint uppercase">
              {t("projects.workspace.idea.overview")}
            </h3>
            <ProjectEstimate
              project={project}
              durationSeconds={durationSeconds}
            />
            <div className="grid h-32 place-items-center rounded-md bg-background">
              <span
                className={cn(
                  "grid place-items-center rounded border border-dashed border-input font-mono text-xs text-muted-foreground",
                  FRAMES[aspectRatio],
                )}
              >
                {aspectRatio}
              </span>
            </div>
            <dl className="divide-y border-t text-[13px]">
              <div className="flex items-center justify-between gap-3 py-2.5">
                <dt className="text-muted-foreground">
                  {t("projects.form.references")}
                </dt>
                <dd className="font-mono text-xs">
                  {project.references.length}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3 pt-2.5">
                <dt className="text-muted-foreground">
                  {t("projects.settings.language")}
                </dt>
                <dd className="min-w-0 truncate">
                  {t(`projects.settings.languages.${language}`)}
                </dd>
              </div>
            </dl>
          </section>
          {/* Saving stays in view, under the overview as on the design board;
              the options it also saves follow below. */}
          {actions}
          {children}
          <p className="border-t pt-5 text-sm font-semibold">
            {t("projects.settings.renderOptions")}
          </p>
          {options}
        </aside>
      </form>
    );

  return (
    <div className="space-y-5">
      <form
        id={`${id}-form`}
        noValidate
        onSubmit={handleSubmit(submit)}
        className="space-y-5"
      >
        {alert}
        {brief}
        {options}
      </form>
      {references}
      {actions}
    </div>
  );
}

const FRAMES = {
  "16:9": "aspect-video w-40",
  "9:16": "aspect-[9/16] h-24",
  "1:1": "aspect-square h-24",
} as const;

// How many scenes the film has, or about how many its duration allows: a
// scene is 5 or 10 seconds long and the script decides the split.
function ProjectEstimate({
  project,
  durationSeconds,
}: {
  project: Project;
  durationSeconds: number;
}) {
  const { t } = useTranslation();
  const known = Number.isFinite(durationSeconds) && durationSeconds >= 10;
  const written =
    project.sceneCount > 0 && durationSeconds === project.durationSeconds;

  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-3xl font-semibold">
          {written
            ? project.sceneCount
            : known
              ? `${Math.ceil(durationSeconds / 10)}–${Math.floor(durationSeconds / 5)}`
              : "—"}
        </span>
        <span className="text-sm text-muted-foreground">
          {t(
            written
              ? "projects.workspace.idea.scenesWritten"
              : "projects.workspace.idea.scenesEstimate",
          )}
          {known && ` · ${formatDuration(durationSeconds)}`}
        </span>
      </p>
      {!written && (
        <p className="text-xs leading-5 text-faint">
          {t("projects.workspace.idea.estimateHint")}
        </p>
      )}
    </div>
  );
}
