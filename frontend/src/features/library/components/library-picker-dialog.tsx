import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { mediaKey, type ProjectMedia } from "@/features/projects/api/media";
import { MEDIA_MAX_FILES } from "@/features/projects/lib/project-media";
import { importToProject, type LibraryFilters } from "../api/library";
import { useLibrary } from "../hooks/use-library";
import { pickerErrorKey } from "../lib/library";
import { LibraryBrowser } from "./library-browser";

const PICKER_MAX_SELECTED = 20;

const INITIAL_FILTERS: LibraryFilters = {
  kind: "all",
  source: "all",
  q: "",
};

export function LibraryPickerDialog({
  projectId,
  onClose,
  onImported,
}: {
  projectId: string;
  onClose: () => void;
  onImported?: (items: ProjectMedia[]) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<LibraryFilters>(INITIAL_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const library = useLibrary(filters);

  const mutation = useMutation({
    mutationFn: importToProject,
    retry: false,
    onSuccess: (items) => {
      queryClient.setQueryData<ProjectMedia[]>(
        mediaKey(projectId),
        (current) => (current ? [...current, ...items] : items),
      );
      void queryClient.invalidateQueries({ queryKey: mediaKey(projectId) });
      onImported?.(items);
      onClose();
    },
  });

  function handleSelectedChange(next: Set<string>) {
    if (next.size > PICKER_MAX_SELECTED && next.size > selected.size) return;
    setSelected(next);
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !mutation.isPending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!mutation.isPending}
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-4 overflow-hidden p-6 sm:max-w-4xl"
      >
        <DialogHeader className="shrink-0 pr-8">
          <DialogTitle>{t("library.picker.title")}</DialogTitle>
          <DialogDescription>
            {t("library.picker.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          <LibraryBrowser
            compact
            selected={selected}
            onSelectedChange={handleSelectedChange}
            library={library}
            filters={filters}
            onFiltersChange={setFilters}
          />
        </div>

        {mutation.isError && (
          <p role="alert" className="shrink-0 text-sm text-destructive">
            {t(pickerErrorKey(mutation.error), { count: MEDIA_MAX_FILES })}
          </p>
        )}

        <DialogFooter className="-mx-6 -mb-6 shrink-0 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={mutation.isPending}
            onClick={onClose}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={selected.size === 0 || mutation.isPending}
            onClick={() =>
              mutation.mutate({ projectId, ids: [...selected] })
            }
          >
            {mutation.isPending
              ? t("library.picker.adding")
              : t("library.picker.add", { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
