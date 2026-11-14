import { Download, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ARCHIVE_LIMIT,
  libraryArchiveHref,
  libraryDownloadHref,
  type LibraryFilters,
  type LibraryItem,
} from "@/features/library/api/library";
import { LibraryBrowser } from "@/features/library/components/library-browser";
import { LibraryPreviewDialog } from "@/features/library/components/library-preview-dialog";
import { useLibrary } from "@/features/library/hooks/use-library";
import type { LibraryErrorKey } from "@/features/library/lib/library";
import {
  MEDIA_ACCEPT,
  MEDIA_MAX_BYTES,
  validateMediaFiles,
} from "@/features/projects/lib/project-media";
import { useDocumentTitle } from "@/hooks/use-document-title";

const LIBRARY_MAX_MB = Math.round(MEDIA_MAX_BYTES / (1024 * 1024));

const INITIAL_FILTERS: LibraryFilters = {
  kind: "all",
  source: "all",
  q: "",
};

export function LibraryPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("pages.library.title"));

  const inputRef = useRef<HTMLInputElement>(null);
  const dismissDeleteRef = useRef<HTMLButtonElement>(null);
  const [filters, setFilters] = useState<LibraryFilters>(INITIAL_FILTERS);
  const library = useLibrary(filters);

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedMap, setSelectedMap] = useState<Map<string, LibraryItem>>(
    () => new Map(),
  );
  const [previewItem, setPreviewItem] = useState<LibraryItem | null>(null);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [validationError, setValidationError] =
    useState<LibraryErrorKey | null>(null);
  const [failedCount, setFailedCount] = useState(0);
  const [dropping, setDropping] = useState(false);

  const activeError = library.error ?? validationError;

  function renderErrorMessage(key: LibraryErrorKey): string {
    if (key === "library.errors.file_too_large") {
      return t(key, { size: LIBRARY_MAX_MB });
    }
    return t(key);
  }

  function handleSelectedChange(next: Set<string>, items: LibraryItem[]) {
    setSelected(next);
    setSelectedMap((previous) => {
      const updated = new Map<string, LibraryItem>();
      const byId = new Map(items.map((item) => [item.id, item]));
      for (const id of next) {
        const found = byId.get(id) ?? previous.get(id);
        if (found) updated.set(id, found);
      }
      return updated;
    });
  }

  function clearSelection() {
    setSelected(new Set());
    setSelectedMap(new Map());
  }

  async function addFiles(picked: File[]) {
    if (picked.length === 0 || library.uploading) return;

    library.clearError();
    setValidationError(null);
    setFailedCount(0);

    const { accepted, errorCode } = validateMediaFiles(picked, 0);
    if (errorCode) {
      setValidationError(`library.errors.${errorCode}` as const);
    }
    if (accepted.length === 0) return;

    const failed = await library.upload(accepted);
    if (failed > 0 && accepted.length > 1) {
      setFailedCount(failed);
    }
  }

  const selectedIds = [...selected];
  const selectedItems = selectedIds
    .map((id) => selectedMap.get(id))
    .filter((item): item is LibraryItem => item !== undefined);
  const allDeletable =
    selectedItems.length === selectedIds.length &&
    selectedItems.every((item) => item.deletable && item.assetId !== null);
  const downloadHref =
    selectedItems.length === 1
      ? libraryDownloadHref(selectedItems[0].url)
      : libraryArchiveHref(selectedIds);
  // One archive holds a limited number of files.
  const canDownload = selectedIds.length <= ARCHIVE_LIMIT;

  async function handleConfirmDelete() {
    const assetIds = selectedItems
      .map((item) => item.assetId)
      .filter((id): id is string => id !== null);
    if (assetIds.length === 0) return;

    setValidationError(null);
    setFailedCount(0);
    library.clearError();
    await library.remove(assetIds);
    setConfirmDeleteOpen(false);
    clearSelection();
  }

  const notice =
    activeError || failedCount > 0 ? (
      <div role="alert" className="space-y-1 text-xs text-destructive">
        {failedCount > 0 && (
          <p>{t("library.failed", { count: failedCount })}</p>
        )}
        {activeError && <p>{renderErrorMessage(activeError)}</p>}
      </div>
    ) : null;

  return (
    <div
      className="relative w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14"
      onDragOver={(event) => {
        if (library.uploading || !event.dataTransfer.types.includes("Files")) {
          return;
        }
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropping(false);
        }
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(false);
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      <PageHeader
        title={t("pages.library.title")}
        description={t("pages.library.description")}
      />

      <input
        ref={inputRef}
        type="file"
        multiple
        accept={MEDIA_ACCEPT}
        disabled={library.uploading}
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])];
          // Clear the input so the same file can be chosen again later.
          event.target.value = "";
          void addFiles(picked);
        }}
        className="hidden"
      />

      <LibraryBrowser
        selected={selected}
        onSelectedChange={handleSelectedChange}
        onOpen={(item) => setPreviewItem(item)}
        library={library}
        filters={filters}
        onFiltersChange={setFilters}
        notice={notice}
        actions={
          <Button
            type="button"
            disabled={library.uploading}
            onClick={() => inputRef.current?.click()}
          >
            <Upload aria-hidden="true" />
            {t(library.uploading ? "library.uploading" : "library.upload")}
          </Button>
        }
      />

      {selected.size > 0 && (
        <div
          role="region"
          aria-label={t("library.selected", { count: selected.size })}
          className="sticky bottom-4 z-10 mt-6 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-2.5 shadow-lg"
        >
          <span className="font-mono text-sm font-semibold tabular-nums">
            {t("library.selected", { count: selected.size })}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canDownload ? (
              <Button asChild variant="outline" size="sm">
                <a href={downloadHref} download>
                  <Download aria-hidden="true" />
                  {t("library.download")}
                </a>
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled
                title={t("library.downloadLimit", { count: ARCHIVE_LIMIT })}
              >
                <Download aria-hidden="true" />
                {t("library.download")}
              </Button>
            )}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={!allDeletable || library.removing}
              title={!allDeletable ? t("library.deleteNote") : undefined}
              onClick={() => setConfirmDeleteOpen(true)}
            >
              <Trash2 aria-hidden="true" />
              {t("library.delete")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={library.removing}
              onClick={clearSelection}
            >
              {t("library.deselect")}
            </Button>
          </div>
        </div>
      )}

      {dropping && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-6 backdrop-blur-xs">
          <div className="flex max-w-md flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-card px-8 py-10 text-center shadow-lg">
            <Upload className="size-8 text-primary" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">
              {t("library.dropHint")}
            </p>
          </div>
        </div>
      )}

      {previewItem && (
        <LibraryPreviewDialog
          item={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}

      <Dialog
        open={confirmDeleteOpen}
        onOpenChange={(next) => {
          if (!library.removing) setConfirmDeleteOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={!library.removing}
          className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            dismissDeleteRef.current?.focus();
          }}
        >
          <DialogHeader className="pr-6">
            <DialogTitle>
              {t("library.deleteTitle", { count: selected.size })}
            </DialogTitle>
            <DialogDescription className="leading-6">
              {t("library.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
            <Button
              ref={dismissDeleteRef}
              type="button"
              variant="outline"
              disabled={library.removing}
              onClick={() => setConfirmDeleteOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="danger"
              disabled={library.removing}
              onClick={() => void handleConfirmDelete()}
            >
              {t(library.removing ? "library.deleting" : "library.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
