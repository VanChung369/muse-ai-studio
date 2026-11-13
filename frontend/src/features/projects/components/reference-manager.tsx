import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/http";
import { projectKeys } from "../api/query-keys";
import { deleteReference, uploadReference } from "../api/references";
import {
  REFERENCE_ACCEPT,
  REFERENCE_ERROR_CODES,
  REFERENCE_MAX_BYTES,
  REFERENCE_MAX_FILES,
} from "../constants";
import type { Project } from "../types";

const ACCEPTED_TYPES = new Set(REFERENCE_ACCEPT.split(","));

export type ReferenceErrorCode = (typeof REFERENCE_ERROR_CODES)[number];
type ReferenceErrorKey =
  | `projects.form.referenceErrors.${ReferenceErrorCode}`
  | "projects.form.referenceErrors.unknown";

function validatePickedFiles(
  picked: FileList,
  existingCount: number,
): { accepted: File[]; errorCode: ReferenceErrorCode | null } {
  const accepted: File[] = [];
  let errorCode: ReferenceErrorCode | null = null;

  for (const file of picked) {
    if (!ACCEPTED_TYPES.has(file.type)) {
      errorCode ??= "unsupported_file";
      continue;
    }
    if (file.size === 0) {
      errorCode ??= "empty_file";
      continue;
    }
    if (file.size > REFERENCE_MAX_BYTES) {
      errorCode ??= "file_too_large";
      continue;
    }
    if (existingCount + accepted.length >= REFERENCE_MAX_FILES) {
      errorCode ??= "too_many_files";
      break;
    }
    accepted.push(file);
  }

  return { accepted, errorCode };
}

function referenceErrorKey(error: unknown): ReferenceErrorKey {
  const code = error instanceof ApiError ? error.code : undefined;
  const known = REFERENCE_ERROR_CODES.find((value) => value === code);
  return known
    ? (`projects.form.referenceErrors.${known}` as const)
    : "projects.form.referenceErrors.unknown";
}

export function ReferenceFilePicker({
  id,
  existingCount,
  disabled = false,
  uploading = false,
  onSelect,
}: {
  id?: string;
  existingCount: number;
  disabled?: boolean;
  uploading?: boolean;
  onSelect: (accepted: File[], errorCode: ReferenceErrorCode | null) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const full = existingCount >= REFERENCE_MAX_FILES;

  return (
    <>
      <input
        ref={inputRef}
        id={id}
        type="file"
        multiple
        accept={REFERENCE_ACCEPT}
        disabled={disabled || uploading || full}
        onChange={(event) => {
          const picked = event.target.files;
          if (!picked || picked.length === 0) return;
          const { accepted, errorCode } = validatePickedFiles(
            picked,
            existingCount,
          );
          // Clear the input so the same file can be chosen again later.
          event.target.value = "";
          onSelect(accepted, errorCode);
        }}
        className="hidden"
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || uploading || full}
        onClick={() => inputRef.current?.click()}
      >
        <Plus aria-hidden="true" />
        {t(
          uploading ? "projects.form.uploading" : "projects.form.addReference",
        )}
      </Button>
    </>
  );
}

export function ReferenceManager({
  project,
  disabled = false,
}: {
  project: Project;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<ReferenceErrorKey | null>(null);
  const busy = uploading || deletingId !== null;

  async function handleFiles(
    accepted: File[],
    validationError: ReferenceErrorCode | null,
  ) {
    setError(
      validationError
        ? (`projects.form.referenceErrors.${validationError}` as const)
        : null,
    );
    if (accepted.length === 0) return;

    setUploading(true);
    try {
      for (const file of accepted) {
        try {
          const created = await uploadReference({
            projectId: project.id,
            file,
          });
          queryClient.setQueryData<Project>(
            projectKeys.detail(project.id),
            (current) =>
              current
                ? { ...current, references: [...current.references, created] }
                : current,
          );
        } catch (err) {
          setError(referenceErrorKey(err));
        }
      }
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove(referenceId: string) {
    setError(null);
    setDeletingId(referenceId);
    try {
      await deleteReference({ projectId: project.id, referenceId });
      queryClient.setQueryData<Project>(
        projectKeys.detail(project.id),
        (current) =>
          current
            ? {
                ...current,
                references: current.references.filter(
                  (item) => item.id !== referenceId,
                ),
              }
            : current,
      );
    } catch (err) {
      setError(referenceErrorKey(err));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {project.references.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {project.references.map((reference) => (
            <div
              key={reference.id}
              className="overflow-hidden rounded-lg border bg-card"
            >
              <div className="aspect-video bg-muted">
                {reference.mime.startsWith("image/") ? (
                  <img
                    src={reference.url}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                  />
                ) : reference.mime.startsWith("video/") ? (
                  <video
                    src={reference.url}
                    muted
                    playsInline
                    preload="metadata"
                    className="size-full object-cover"
                  />
                ) : null}
              </div>
              <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                <span className="min-w-0 truncate text-xs" title={reference.name}>
                  {reference.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled || busy}
                  onClick={() => void handleRemove(reference.id)}
                  aria-label={t("projects.form.removeReference", {
                    name: reference.name,
                  })}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(error)}
        </p>
      )}
      <ReferenceFilePicker
        existingCount={project.references.length}
        disabled={disabled || busy}
        uploading={uploading}
        onSelect={(accepted, validationError) =>
          void handleFiles(accepted, validationError)
        }
      />
    </div>
  );
}
