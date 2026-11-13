import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useId } from "react";
import { Controller } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useScriptEditor } from "../hooks/use-script-editor";
import type { Project } from "../types";

type Props = { project: Project; onClose: () => void };

export function ProjectScriptEditor({ project, onClose }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const editor = useScriptEditor(project, onClose);
  const {
    register,
    control,
    formState: { errors },
  } = editor.form;
  const { fields, append, remove, move } = editor.sceneArray;
  const { durationMatches } = editor;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) editor.requestClose();
      }}
    >
      <DialogContent
        showCloseButton={!editor.isSubmitting}
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
      >
        <DialogHeader className="shrink-0 border-b p-6 pr-12">
          <DialogTitle>{t("projects.script.editorTitle")}</DialogTitle>
          <DialogDescription>
            {t("projects.script.editorDescription", { name: project.name })}
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={editor.submit}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-6">
            <fieldset disabled={editor.isSubmitting} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor={`${id}-characters`}>
                  {t("projects.script.characters")}
                </Label>
                <Textarea
                  {...register("characterBible")}
                  id={`${id}-characters`}
                  rows={3}
                  maxLength={10000}
                  placeholder={t("projects.script.charactersPlaceholder")}
                  aria-invalid={Boolean(errors.characterBible)}
                />
                {errors.characterBible && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("projects.script.errors.characters")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-style`}>
                  {t("projects.script.visualStyle")}
                </Label>
                <Textarea
                  {...register("visualStyle")}
                  id={`${id}-style`}
                  rows={2}
                  maxLength={3000}
                  placeholder={t("projects.script.stylePlaceholder")}
                  aria-invalid={Boolean(errors.visualStyle)}
                />
                {errors.visualStyle && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("projects.script.errors.style")}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-semibold">
                  {t("projects.details.script")}
                </h3>
                <p className="text-xs leading-5 text-faint">
                  {t("projects.script.outlineHint")}
                </p>
              </div>
              <ol className="space-y-4">
                {fields.map((field, index) => (
                  <li
                    key={field.id}
                    data-slot="script-scene"
                    className="space-y-4 rounded-xl border bg-card p-4"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h4 className="text-xs font-semibold text-primary">
                        {t("projects.details.scene", { number: index + 1 })}
                      </h4>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === 0}
                          aria-label={t("projects.script.moveUp", {
                            number: index + 1,
                          })}
                          onClick={() => move(index, index - 1)}
                        >
                          <ArrowUp aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          disabled={index === fields.length - 1}
                          aria-label={t("projects.script.moveDown", {
                            number: index + 1,
                          })}
                          onClick={() => move(index, index + 1)}
                        >
                          <ArrowDown aria-hidden="true" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t("projects.script.remove", {
                            number: index + 1,
                          })}
                          onClick={() => remove(index)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-[1fr_7rem]">
                      <div className="space-y-2">
                        <Label htmlFor={`${id}-${field.id}-title`}>
                          {t("projects.script.sceneTitle")}
                        </Label>
                        <Input
                          {...register(`scenes.${index}.title`)}
                          id={`${id}-${field.id}-title`}
                          maxLength={300}
                          aria-invalid={Boolean(errors.scenes?.[index]?.title)}
                        />
                        {errors.scenes?.[index]?.title && (
                          <p role="alert" className="text-xs text-destructive">
                            {t("projects.script.errors.title")}
                          </p>
                        )}
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${id}-${field.id}-duration`}>
                          {t("projects.details.duration")}
                        </Label>
                        <Controller
                          name={`scenes.${index}.durationSeconds`}
                          control={control}
                          render={({ field: duration }) => (
                            <Select
                              value={String(duration.value)}
                              onValueChange={(value) =>
                                duration.onChange(Number(value))
                              }
                              disabled={editor.isSubmitting}
                            >
                              <SelectTrigger
                                id={`${id}-${field.id}-duration`}
                                ref={duration.ref}
                                onBlur={duration.onBlur}
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent position="popper">
                                {[5, 10].map((seconds) => (
                                  <SelectItem
                                    key={seconds}
                                    value={String(seconds)}
                                  >
                                    {t("projects.script.seconds", {
                                      count: seconds,
                                    })}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${id}-${field.id}-prompt`}>
                        {t("projects.script.prompt")}
                      </Label>
                      <Textarea
                        {...register(`scenes.${index}.prompt`)}
                        id={`${id}-${field.id}-prompt`}
                        rows={4}
                        maxLength={6000}
                        placeholder={t("projects.script.promptPlaceholder")}
                        aria-invalid={Boolean(errors.scenes?.[index]?.prompt)}
                      />
                      {errors.scenes?.[index]?.prompt && (
                        <p role="alert" className="text-xs text-destructive">
                          {t("projects.script.errors.prompt")}
                        </p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`${id}-${field.id}-narration`}>
                        {t("projects.script.narration")}
                      </Label>
                      <Textarea
                        {...register(`scenes.${index}.narration`)}
                        id={`${id}-${field.id}-narration`}
                        rows={2}
                        maxLength={600}
                        placeholder={t("projects.script.narrationPlaceholder")}
                        aria-invalid={Boolean(
                          errors.scenes?.[index]?.narration,
                        )}
                      />
                      {errors.scenes?.[index]?.narration && (
                        <p role="alert" className="text-xs text-destructive">
                          {t("projects.script.errors.narration")}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              <ActionBar>
                <Button
                  type="button"
                  variant="outline"
                  disabled={fields.length >= 30}
                  onClick={() =>
                    append({
                      title: "",
                      prompt: "",
                      narration: "",
                      durationSeconds: 10,
                    })
                  }
                >
                  <Plus aria-hidden="true" />
                  {t("projects.script.add")}
                </Button>
              </ActionBar>
              {errors.scenes?.root && (
                <p role="alert" className="text-xs text-destructive">
                  {t("projects.script.errors.scenes")}
                </p>
              )}
            </fieldset>
          </div>
          <div className="shrink-0 border-t px-6 pt-4">
            <p
              role="status"
              className={`text-xs ${durationMatches ? "text-muted-foreground" : "text-destructive"}`}
            >
              {t("projects.script.timeline", {
                count: fields.length,
                actual: editor.totalDuration,
                target: project.durationSeconds,
              })}
              {!durationMatches && (
                <span className="mt-1 block">
                  {t("projects.script.errors.duration")}
                </span>
              )}
            </p>
            {editor.locked ? (
              <p role="alert" className="mt-3 text-xs text-destructive">
                {t("projects.script.errors.locked")}
              </p>
            ) : editor.conflict ? (
              <div
                role="alert"
                className="mt-3 space-y-3 rounded-lg border border-destructive/30 p-3"
              >
                <p className="text-xs text-destructive">
                  {t("projects.script.errors.conflict")}
                </p>
                {editor.newerVersionLoaded && (
                  <ActionBar>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={editor.loadLatest}
                    >
                      {t("projects.script.loadLatest")}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={editor.overwriteWithMine}
                    >
                      {t("projects.script.overwrite")}
                    </Button>
                  </ActionBar>
                )}
              </div>
            ) : (
              editor.saveError && (
                <p role="alert" className="mt-3 text-xs text-destructive">
                  {t("projects.script.errors.save")}
                </p>
              )
            )}
            {editor.confirmDiscard && (
              <div
                role="alert"
                className="mt-3 space-y-3 rounded-lg border border-warning/30 p-3"
              >
                <p className="text-sm">
                  {t("projects.script.discardQuestion")}
                </p>
                <ActionBar>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={editor.keepEditing}
                  >
                    {t("projects.script.keepEditing")}
                  </Button>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={editor.discard}
                  >
                    {t("projects.script.discard")}
                  </Button>
                </ActionBar>
              </div>
            )}
          </div>
          <DialogFooter className="m-0 shrink-0 border-0 bg-transparent px-6 py-4">
            <Button
              type="button"
              variant="outline"
              disabled={editor.isSubmitting}
              onClick={editor.requestClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              disabled={!editor.canSave}
            >
              {t(
                editor.isSubmitting
                  ? "projects.form.saving"
                  : "projects.script.save",
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
