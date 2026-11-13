import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { ApiError } from "@/lib/http";
import { getScriptDraft, isScriptEditable } from "../lib/project-script";
import { projectScriptDraftSchema } from "../schemas";
import type { Project, ProjectScriptDraft } from "../types";
import { useSaveProjectScript } from "./use-project-queries";

// `project` is the live detail query data, so it updates when a conflict or
// status change refetches the project while the editor is open.
export function useScriptEditor(project: Project, onClose: () => void) {
  const mutation = useSaveProjectScript();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const form = useForm<ProjectScriptDraft>({
    resolver: zodResolver(projectScriptDraftSchema),
    defaultValues: getScriptDraft(project),
  });
  const sceneArray = useFieldArray({ control: form.control, name: "scenes" });
  const scenes = useWatch({ control: form.control, name: "scenes" });
  const expectedRevision = useWatch({
    control: form.control,
    name: "expectedRevision",
  });
  const totalDuration = scenes.reduce(
    (sum, scene) => sum + scene.durationSeconds,
    0,
  );
  const durationMatches = totalDuration === project.durationSeconds;
  const { isDirty, isSubmitting } = form.formState;
  const errorCode =
    mutation.error instanceof ApiError ? mutation.error.code : undefined;
  // Locked when the server said so or the refetched status no longer allows
  // edits (e.g. a render started while the editor was open). Unsaved text
  // stays on screen so it can be copied.
  const locked =
    errorCode === "script_locked" || !isScriptEditable(project.status);
  const conflict = errorCode === "script_conflict" && !locked;
  // The refetched project has a newer revision than the one being edited.
  const newerVersionLoaded =
    conflict && project.scriptRevision !== expectedRevision;

  function requestClose() {
    if (isSubmitting) return;
    if (isDirty) setConfirmDiscard(true);
    else onClose();
  }

  async function save(values: ProjectScriptDraft) {
    try {
      await mutation.mutateAsync({ id: project.id, values });
      onClose();
    } catch {
      // Keep unsaved fields intact; the dialog renders the mutation error.
    }
  }

  const submit = form.handleSubmit(save);

  return {
    form,
    sceneArray,
    totalDuration,
    durationMatches,
    isSubmitting,
    canSave: durationMatches && scenes.length > 0 && !locked && !isSubmitting,
    confirmDiscard,
    keepEditing: () => setConfirmDiscard(false),
    discard: onClose,
    requestClose,
    submit,
    saveError: mutation.isError,
    conflict,
    locked,
    newerVersionLoaded,
    // Conflict resolution: never bump the revision silently, or this save
    // would overwrite the other editor's changes without anyone noticing.
    loadLatest: () => {
      form.reset(getScriptDraft(project));
      mutation.reset();
    },
    overwriteWithMine: () => {
      form.setValue("expectedRevision", project.scriptRevision);
      mutation.reset();
      void submit();
    },
  };
}
