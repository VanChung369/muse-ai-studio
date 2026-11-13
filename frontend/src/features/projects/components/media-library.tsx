import {
  AudioLines,
  Check,
  Film,
  Image,
  Pause,
  Play,
  Plus,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProjectMedia } from "../api/media";
import { useProjectMedia } from "../hooks/use-project-media";
import { startMediaDrag } from "../lib/media-drag";
import {
  formatBytes,
  MEDIA_ACCEPT,
  MEDIA_MAX_FILES,
  type MediaErrorKey,
  validateMediaFiles,
} from "../lib/project-media";

const MEDIA_MAX_MB = 200;
const KIND_ICONS = { video: Film, image: Image, audio: AudioLines } as const;
const CHIP =
  "flex h-5 items-center gap-1 rounded bg-black/70 px-1.5 text-[10px] font-medium text-white";

// The files a user added to a project: uploaded here, then dragged (or sent
// with the button) onto the picture or audio track of the timeline.
export function MediaLibrary({
  projectId,
  disabled = false,
  usedIds,
  onAddClip,
  onAddAudio,
}: {
  projectId: string;
  // True while nothing may change (the film is being merged, or the page is read-only).
  disabled?: boolean;
  // Ids of media that are placed in the film: these show "In the film" and cannot be deleted.
  usedIds?: ReadonlySet<string>;
  // A video or picture should be appended to the film.
  onAddClip?: (media: ProjectMedia) => void;
  // An audio file should be added to the audio track.
  onAddAudio?: (media: ProjectMedia) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    query,
    upload,
    uploading,
    remove,
    removingId,
    error: hookError,
    clearError,
  } = useProjectMedia(projectId);
  const [validationError, setValidationError] = useState<MediaErrorKey | null>(
    null,
  );
  const [failedCount, setFailedCount] = useState(0);
  // Files are being dragged over the library.
  const [dropping, setDropping] = useState(false);

  const items = query.data;
  const full = items !== undefined && items.length >= MEDIA_MAX_FILES;
  const activeError = hookError ?? validationError;
  const locked = disabled || uploading || full;

  function renderErrorMessage(key: MediaErrorKey): string {
    if (key === "projects.media.errors.file_too_large") {
      return t(key, { size: MEDIA_MAX_MB });
    }
    if (key === "projects.media.errors.too_many_files") {
      return t(key, { count: MEDIA_MAX_FILES });
    }
    return t(key);
  }

  // Files picked in the dialog or dropped on the library.
  async function addFiles(picked: File[]) {
    if (picked.length === 0 || locked) return;

    clearError();
    setValidationError(null);
    setFailedCount(0);

    const { accepted, errorCode } = validateMediaFiles(
      picked,
      items?.length ?? 0,
    );

    if (errorCode) {
      setValidationError(`projects.media.errors.${errorCode}` as const);
    }
    if (accepted.length === 0) return;

    const failed = await upload(accepted);
    if (failed > 0 && accepted.length > 1) {
      setFailedCount(failed);
    }
  }

  async function handleRemove(mediaId: string) {
    setValidationError(null);
    setFailedCount(0);
    await remove(mediaId);
  }

  return (
    <section
      aria-label={t("projects.media.title")}
      className="space-y-3"
      onDragOver={(event) => {
        if (locked || !event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={(event) => {
        // Leaving for a child is still inside the library.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setDropping(false);
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setDropping(false);
        void addFiles([...event.dataTransfer.files]);
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 basis-64 text-xs leading-5 text-faint">
          {t("projects.media.hint", {
            count: MEDIA_MAX_FILES,
            size: MEDIA_MAX_MB,
          })}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={MEDIA_ACCEPT}
          disabled={locked}
          onChange={(event) => {
            const picked = [...(event.target.files ?? [])];
            // Clear the input so the same file can be chosen again later.
            event.target.value = "";
            void addFiles(picked);
          }}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked}
          onClick={() => inputRef.current?.click()}
        >
          <Upload aria-hidden="true" />
          {t(uploading ? "projects.media.uploading" : "projects.media.upload")}
        </Button>
      </div>

      {(activeError || failedCount > 0) && (
        <div role="alert" className="space-y-1 text-xs text-destructive">
          {failedCount > 0 && (
            <p>{t("projects.media.failed", { count: failedCount })}</p>
          )}
          {activeError && <p>{renderErrorMessage(activeError)}</p>}
        </div>
      )}

      {query.isError ? (
        <div role="alert" className="space-y-2">
          <p className="text-sm text-muted-foreground">
            {t("projects.media.errors.unknown")}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      ) : items === undefined ? null : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-3">
          {/* Always first: where videos, pictures and audio come in. */}
          <button
            type="button"
            disabled={locked}
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex min-h-44 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-center disabled:opacity-50",
              dropping
                ? "border-primary bg-primary-soft text-primary"
                : "border-input text-muted-foreground hover:border-primary-line hover:bg-primary-soft hover:text-foreground",
            )}
          >
            <span className="grid size-9 place-items-center rounded-full bg-secondary">
              <Upload className="size-4" aria-hidden="true" />
            </span>
            <span className="text-[13px] font-medium">
              {t(uploading ? "projects.media.uploading" : "projects.media.drop")}
            </span>
            <span className="text-[11px] leading-4 text-faint">
              {t("projects.media.formats")}
            </span>
          </button>

          {items.map((item) => {
            const inUse = usedIds?.has(item.id) ?? false;
            const busy = disabled || uploading || removingId === item.id;
            const add = item.kind === "audio" ? onAddAudio : onAddClip;
            const Kind = KIND_ICONS[item.kind];

            return (
              <article
                key={item.id}
                // Dragged onto the picture or audio track of the timeline.
                draggable={!busy && Boolean(add)}
                onDragStart={(event) => startMediaDrag(event, item)}
                className={cn(
                  "flex flex-col overflow-hidden rounded-lg border bg-background",
                  !busy && add && "cursor-grab active:cursor-grabbing",
                  removingId === item.id && "opacity-50",
                )}
              >
                <div className="relative h-24 overflow-hidden bg-card">
                  {item.kind === "audio" ? (
                    <>
                      <Kind
                        className="absolute inset-0 m-auto size-6 text-faint"
                        aria-hidden="true"
                      />
                      {item.waveformUrl && (
                        // The file's sound, drawn; it covers the icon once loaded.
                        <img
                          src={item.waveformUrl}
                          alt=""
                          loading="lazy"
                          draggable={false}
                          onError={(event) => {
                            event.currentTarget.hidden = true;
                          }}
                          className="absolute inset-x-2 inset-y-3 h-[calc(100%-1.5rem)] w-[calc(100%-1rem)] bg-card opacity-70"
                        />
                      )}
                      <PlayButton src={item.url} name={item.name} />
                    </>
                  ) : item.thumbnailUrl ? (
                    <img
                      src={item.thumbnailUrl}
                      alt=""
                      loading="lazy"
                      // The card is what gets dragged, not the picture alone.
                      draggable={false}
                      className="absolute inset-0 size-full object-cover"
                    />
                  ) : (
                    <Kind
                      className="absolute inset-0 m-auto size-6 text-faint"
                      aria-hidden="true"
                    />
                  )}
                  <span className={cn(CHIP, "absolute top-1.5 left-1.5")}>
                    <Kind className="size-3" aria-hidden="true" />
                    {t(`projects.media.kinds.${item.kind}`)}
                  </span>
                  {inUse && (
                    <span className="absolute top-1.5 right-1.5 flex h-5 items-center gap-1 rounded bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                      <Check className="size-3" aria-hidden="true" />
                      {t("projects.media.inUse")}
                    </span>
                  )}
                  {item.seconds !== null && (
                    <span
                      className={cn(
                        CHIP,
                        "absolute right-1.5 bottom-1.5 font-mono",
                      )}
                    >
                      {formatDuration(Math.round(item.seconds))}
                    </span>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-2 p-2.5">
                  <div className="min-w-0">
                    <p
                      className="truncate text-[13px] font-medium"
                      title={item.name}
                    >
                      {item.name}
                    </p>
                    <p className="flex items-center gap-1 truncate text-[11px] text-faint">
                      {formatBytes(item.size)}
                      {item.source === "muse" && (
                        <>
                          {" · "}
                          <Sparkles className="size-3" aria-hidden="true" />
                          {t("projects.media.fromMuse")}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="mt-auto flex items-center gap-1.5">
                    {add && (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="min-w-0 flex-1"
                        disabled={busy}
                        onClick={() => add(item)}
                      >
                        <Plus aria-hidden="true" />
                        <span className="truncate">
                          {t(
                            item.kind === "audio"
                              ? "projects.media.addAsMusic"
                              : "projects.media.addToTimeline",
                          )}
                        </span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="ml-auto shrink-0 text-muted-foreground hover:text-destructive"
                      disabled={busy || inUse}
                      title={inUse ? t("projects.media.inUseHint") : undefined}
                      onClick={() => void handleRemove(item.id)}
                      aria-label={t("projects.media.remove", {
                        name: item.name,
                      })}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

// Plays an audio file from its card, so it can be heard before it is placed.
function PlayButton({ src, name }: { src: string; name: string }) {
  const { t } = useTranslation();
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);

  return (
    <>
      <audio
        ref={audio}
        src={src}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
      <button
        type="button"
        aria-label={t(
          playing ? "projects.media.pause" : "projects.media.play",
          { name },
        )}
        onClick={() => {
          const player = audio.current;
          if (!player) return;
          if (player.paused) void player.play().catch(() => undefined);
          else player.pause();
        }}
        className={cn(
          "absolute inset-0 m-auto grid size-9 place-items-center rounded-full text-white hover:bg-primary hover:text-primary-foreground",
          playing ? "bg-primary text-primary-foreground" : "bg-black/65",
        )}
      >
        {playing ? (
          <Pause className="size-4" aria-hidden="true" />
        ) : (
          <Play className="size-4 translate-x-px" aria-hidden="true" />
        )}
      </button>
    </>
  );
}
