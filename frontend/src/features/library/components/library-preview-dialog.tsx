import { AudioLines, Clapperboard, Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/features/projects/lib/project-media";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { type LibraryItem, libraryDownloadHref } from "../api/library";
import { libraryItemMeta, libraryItemTitle } from "../lib/library";

export function LibraryPreviewDialog({
  item,
  onClose,
}: {
  item: LibraryItem;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();

  const name = libraryItemTitle(item, t);
  const meta = libraryItemMeta(item, t, language, now);
  const hasProject =
    (item.role === "scene" || item.role === "film") &&
    item.projectId !== null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto p-0 sm:max-w-4xl">
        <div className="flex flex-col tablet:flex-row">
          <div className="flex min-w-0 flex-1 items-center justify-center bg-background p-4">
            {item.kind === "video" && (
              <video
                src={item.url}
                poster={item.thumbnailUrl ?? undefined}
                controls
                className="max-h-[65svh] w-full rounded-lg bg-card"
              />
            )}
            {item.kind === "image" && (
              <img
                src={item.url}
                alt={name}
                className="max-h-[65svh] w-auto max-w-full rounded-lg object-contain"
              />
            )}
            {item.kind === "audio" && (
              <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-lg bg-card p-6">
                {item.waveformUrl ? (
                  <img
                    src={item.waveformUrl}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                    className="max-h-28 w-full object-contain"
                  />
                ) : (
                  <AudioLines
                    className="size-10 text-faint"
                    aria-hidden="true"
                  />
                )}
                <audio src={item.url} controls className="w-full" />
              </div>
            )}
          </div>

          <div className="flex w-full shrink-0 flex-col gap-4 border-t p-5 tablet:w-72 tablet:border-t-0 tablet:border-l">
            <DialogHeader className="pr-8">
              <DialogTitle className="leading-snug wrap-break-word">
                {name}
              </DialogTitle>
              <DialogDescription className="text-xs text-faint">
                {meta}
              </DialogDescription>
            </DialogHeader>

            {item.size !== null && (
              <p className="font-mono text-xs text-muted-foreground tabular-nums">
                {formatBytes(item.size)}
              </p>
            )}

            <div className="mt-auto flex flex-col gap-2">
              <Button asChild>
                <a href={libraryDownloadHref(item.url)} download>
                  <Download aria-hidden="true" />
                  {t("library.download")}
                </a>
              </Button>
              {hasProject && item.projectId && (
                <Button asChild variant="outline">
                  <Link to={`/projects/${encodeURIComponent(item.projectId)}`}>
                    <Clapperboard aria-hidden="true" />
                    {t("library.openProject")}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
