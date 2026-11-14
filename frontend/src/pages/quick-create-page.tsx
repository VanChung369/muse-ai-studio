import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Download,
  Eye,
  Film,
  Image,
  Images,
  LoaderCircle,
  Pencil,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/constants/routes";
import {
  fetchQuickBatches,
  MAX_QUICK_COUNT,
  quickCreateKey,
  requestQuickCreate,
  setQuickBatchHidden,
  type QuickBatch,
  type QuickRequest,
} from "@/features/create/api/quick-create";
import {
  libraryArchiveHref,
  libraryKeys,
  uploadToLibrary,
  type LibraryItem,
} from "@/features/library/api/library";
import { LibraryPreviewDialog } from "@/features/library/components/library-preview-dialog";
import { libraryErrorKey } from "@/features/library/lib/library";
import { downloadHref } from "@/features/projects/lib/project-render";
import { taskKeys } from "@/features/tasks/api/query-keys";
import { TaskActionDialog } from "@/features/tasks/components/task-action-dialog";
import { TaskStatusBadge } from "@/features/tasks/components/task-status-badge";
import { isTaskActive, taskErrorKey } from "@/features/tasks/lib/task-format";
import type { Task } from "@/features/tasks/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useLanguage } from "@/hooks/use-language";
import { ApiError } from "@/lib/http";
import { cn } from "@/lib/utils";

const RATIOS = ["16:9", "9:16", "1:1"] as const;
const COUNT_OPTIONS = [1, 2, 4, "custom"] as const;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function QuickCreatePage() {
  const { t } = useTranslation();
  const client = useQueryClient();
  useDocumentTitle(t("pages.create.title"));
  const [kind, setKind] = useState<QuickRequest["kind"]>("image");
  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] =
    useState<QuickRequest["aspectRatio"]>("1:1");
  const [countOption, setCountOption] =
    useState<(typeof COUNT_OPTIONS)[number]>(4);
  const [customCount, setCustomCount] = useState("5");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [referenceAsset, setReferenceAsset] = useState<LibraryItem | null>(
    null,
  );
  const [fileError, setFileError] = useState<"type" | "size" | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const referenceUrl = useRef<string | null>(null);
  const countInput = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<LibraryItem | null>(null);
  const [retry, setRetry] = useState<Task | null>(null);
  const [dismissedBatch, setDismissedBatch] = useState<string | null>(null);
  const count =
    kind === "video"
      ? 1
      : countOption === "custom"
        ? Number(customCount)
        : countOption;
  const validCount =
    Number.isInteger(count) &&
    count >= 1 &&
    count <= MAX_QUICK_COUNT &&
    (kind !== "image" || countOption !== "custom" || count > 4);

  useEffect(
    () => () => {
      if (referenceUrl.current) URL.revokeObjectURL(referenceUrl.current);
    },
    [],
  );

  const history = useQuery({
    queryKey: quickCreateKey,
    queryFn: ({ signal }) => fetchQuickBatches(signal),
    retry: false,
    refetchInterval: 4000,
  });
  const historyChange = useMutation({
    mutationFn: setQuickBatchHidden,
    retry: false,
    onSuccess: async (_, { batchId, hidden }) => {
      await client.cancelQueries({ queryKey: quickCreateKey });
      if (hidden) {
        client.setQueryData<QuickBatch[]>(quickCreateKey, (previous) =>
          previous?.filter((batch) => batch.id !== batchId),
        );
        setDismissedBatch(batchId);
      } else {
        setDismissedBatch(null);
      }
      void client.invalidateQueries({ queryKey: quickCreateKey });
    },
  });
  const request = useMutation({
    mutationFn: async (values: Omit<QuickRequest, "referenceAssetId">) => {
      let asset = referenceAsset;
      if (file && !asset) {
        asset = await uploadToLibrary(file);
        setReferenceAsset(asset);
        void client.invalidateQueries({ queryKey: libraryKeys.all });
      }
      return requestQuickCreate({
        ...values,
        referenceAssetId: asset?.assetId ?? null,
      });
    },
    retry: false,
    onSuccess: async (batch) => {
      await client.cancelQueries({ queryKey: quickCreateKey });
      client.setQueryData<QuickBatch[]>(quickCreateKey, (previous) =>
        [
          batch,
          ...(previous ?? []).filter((item) => item.id !== batch.id),
        ].slice(0, 20),
      );
      void client.invalidateQueries({ queryKey: quickCreateKey });
      void client.invalidateQueries({ queryKey: taskKeys.all });
    },
  });

  // Mark the library stale when a new generated file becomes available.
  const completedIds =
    history.data
      ?.flatMap((batch) => batch.items.map((item) => item.id))
      .join(",") ?? "";
  useEffect(() => {
    void client.invalidateQueries({ queryKey: libraryKeys.all });
  }, [client, completedIds]);

  function chooseFile(next: File | undefined) {
    if (!next) return;
    if (!IMAGE_TYPES.includes(next.type)) {
      setFileError("type");
      return;
    }
    if (next.size > 20 * 1024 * 1024) {
      setFileError("size");
      return;
    }
    setFileError(null);
    if (referenceUrl.current) URL.revokeObjectURL(referenceUrl.current);
    referenceUrl.current = URL.createObjectURL(next);
    setFileUrl(referenceUrl.current);
    setFile(next);
    setReferenceAsset(null);
    request.reset();
  }

  function clearReference() {
    if (referenceUrl.current) URL.revokeObjectURL(referenceUrl.current);
    referenceUrl.current = null;
    setFileUrl(null);
    setFile(null);
    setReferenceAsset(null);
    setFileError(null);
  }

  function reuse(batch: QuickBatch) {
    setKind(batch.kind);
    setPrompt(batch.prompt);
    setAspectRatio(batch.aspectRatio);
    setCountOption(
      batch.count > 4 || batch.count === 3
        ? "custom"
        : (batch.count as 1 | 2 | 4),
    );
    setCustomCount(String(Math.max(batch.count, 5)));
    clearReference();
    request.reset();
    promptInput.current?.focus();
    promptInput.current?.scrollIntoView({
      behavior: "smooth",
      block: "center",
    });
  }

  const errorCode =
    request.error instanceof ApiError ? request.error.code : undefined;
  const requestError =
    errorCode === "account_unavailable"
      ? t("tasks.errors.account_unavailable")
      : errorCode === "reference_missing"
        ? t("quickCreate.referenceMissing")
        : request.error instanceof ApiError && request.error.status === 422
          ? t("quickCreate.invalidRequest")
          : t(libraryErrorKey(request.error));

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.create.title")}
        description={t("quickCreate.description")}
      />
      <div className="grid items-start gap-6 desktop:grid-cols-[minmax(20rem,24rem)_minmax(0,1fr)]">
        <form
          aria-label={t("quickCreate.configuration")}
          className="min-w-0 space-y-5 rounded-xl border bg-card p-5 desktop:sticky desktop:top-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              !request.isPending &&
              prompt.trim() &&
              validCount &&
              !fileError
            ) {
              request.mutate({
                kind,
                prompt: prompt.trim(),
                aspectRatio,
                count,
              });
            }
          }}
        >
          <fieldset disabled={request.isPending} className="min-w-0 space-y-5">
            <ChoiceGroup label={t("quickCreate.contentType")}>
              {(["image", "video"] as const).map((value) => {
                const Icon = value === "image" ? Image : Film;
                return (
                  <Choice
                    key={value}
                    selected={kind === value}
                    onClick={() => {
                      setKind(value);
                      request.reset();
                      if (value === "video") setAspectRatio("16:9");
                    }}
                  >
                    <Icon className="size-4" aria-hidden="true" />
                    {t(`quickCreate.kinds.${value}`)}
                  </Choice>
                );
              })}
            </ChoiceGroup>
            <div className="space-y-2">
              <Label htmlFor="quick-prompt">{t("quickCreate.prompt")}</Label>
              <Textarea
                ref={promptInput}
                id="quick-prompt"
                value={prompt}
                maxLength={4000}
                required
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t(
                  kind === "image"
                    ? "quickCreate.imagePlaceholder"
                    : "quickCreate.videoPlaceholder",
                )}
                className="min-h-36 resize-y text-sm leading-6"
              />
            </div>
            <div className="space-y-2">
              <Label>{t("quickCreate.ratio")}</Label>
              <ChoiceGroup label={t("quickCreate.ratio")}>
                {RATIOS.map((value) => (
                  <Choice
                    key={value}
                    selected={aspectRatio === value}
                    onClick={() => setAspectRatio(value)}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "block rounded-[2px] border border-current",
                        value === "16:9"
                          ? "h-2.5 w-4"
                          : value === "9:16"
                            ? "h-4 w-2.5"
                            : "size-3",
                      )}
                    />
                    {value}
                  </Choice>
                ))}
              </ChoiceGroup>
            </div>
            {kind === "image" ? (
              <div className="space-y-2">
                <Label>{t("quickCreate.quantity")}</Label>
                <ChoiceGroup label={t("quickCreate.quantity")}>
                  {COUNT_OPTIONS.map((value) => (
                    <Choice
                      key={value}
                      selected={countOption === value}
                      onClick={() => {
                        setCountOption(value);
                        if (value === "custom")
                          requestAnimationFrame(() =>
                            countInput.current?.focus(),
                          );
                      }}
                    >
                      {value === "custom"
                        ? t("quickCreate.moreThanFour")
                        : t("quickCreate.imageCount", { count: value })}
                    </Choice>
                  ))}
                </ChoiceGroup>
                {countOption === "custom" && (
                  <div className="space-y-2 rounded-lg border bg-background/50 p-3">
                    <Label htmlFor="quick-count" className="text-xs">
                      {t("quickCreate.customQuantity")}
                    </Label>
                    <Input
                      ref={countInput}
                      id="quick-count"
                      type="number"
                      inputMode="numeric"
                      min={5}
                      max={MAX_QUICK_COUNT}
                      step={1}
                      required
                      value={customCount}
                      aria-invalid={!validCount}
                      aria-describedby="quick-count-hint"
                      onChange={(event) => setCustomCount(event.target.value)}
                      className="font-mono"
                    />
                    <p
                      id="quick-count-hint"
                      className={cn(
                        "text-xs leading-5",
                        validCount ? "text-faint" : "text-destructive",
                      )}
                    >
                      {t("quickCreate.quantityHint", { max: MAX_QUICK_COUNT })}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2 rounded-lg border bg-background/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("quickCreate.duration")}
                </p>
                <p className="text-sm">{t("quickCreate.videoDuration")}</p>
              </div>
            )}
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="quick-reference">
                  {t(
                    kind === "image"
                      ? "quickCreate.reference"
                      : "quickCreate.startFrame",
                  )}
                </Label>
                <span className="text-xs text-faint">
                  {t("quickCreate.optional")}
                </span>
              </div>
              <input
                ref={fileInput}
                id="quick-reference"
                type="file"
                accept={IMAGE_TYPES.join(",")}
                className="sr-only"
                onChange={(event) => {
                  chooseFile(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
              {file && fileUrl ? (
                <div className="flex items-center gap-3 rounded-lg border bg-background/50 p-3">
                  <img
                    src={fileUrl}
                    alt=""
                    className="size-14 shrink-0 rounded-md object-cover"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-xs"
                    title={file.name}
                  >
                    {file.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("quickCreate.removeReference")}
                    onClick={() => {
                      clearReference();
                      request.reset();
                    }}
                  >
                    <X aria-hidden="true" />
                  </Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragOver(false);
                    chooseFile(event.dataTransfer.files[0]);
                  }}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border border-dashed p-4 text-left text-muted-foreground transition-colors hover:border-primary hover:bg-primary-soft",
                    dragOver && "border-primary bg-primary-soft",
                  )}
                >
                  <Upload className="size-5 shrink-0" aria-hidden="true" />
                  <span className="text-[13px] leading-5">
                    {t("quickCreate.dropImage")}
                  </span>
                </button>
              )}
              <p className="text-xs text-faint">{t("quickCreate.fileHint")}</p>
              {fileError && (
                <p role="alert" className="text-xs text-destructive">
                  {t(`quickCreate.fileErrors.${fileError}`)}
                </p>
              )}
            </div>
            <div className="flex items-center justify-between border-t pt-4 text-[13px]">
              <span className="text-muted-foreground">
                {t("quickCreate.account")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-success" />
                {t("quickCreate.automatic")}
              </span>
            </div>
            {request.isError && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-[13px] leading-5 text-destructive"
              >
                {requestError}
              </p>
            )}
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={
                request.isPending ||
                !prompt.trim() ||
                !validCount ||
                !!fileError
              }
            >
              {request.isPending ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Sparkles aria-hidden="true" />
              )}
              {request.isPending
                ? t("quickCreate.submitting")
                : kind === "image"
                  ? t("quickCreate.createImages", {
                      count: validCount ? count : 0,
                    })
                  : t("quickCreate.createVideo")}
            </Button>
          </fieldset>
        </form>

        <section
          aria-label={t("quickCreate.recent")}
          className="min-w-0 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold">
              {t("quickCreate.recent")}
            </h2>
            <Button variant="link" size="sm" asChild>
              <Link to={ROUTES.LIBRARY}>
                {t("quickCreate.openLibrary")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
          {dismissedBatch && (
            <div
              role="status"
              className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3 text-xs leading-5 text-muted-foreground"
            >
              <span>{t("quickCreate.dismissed")}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={historyChange.isPending}
                onClick={() =>
                  historyChange.mutate({
                    batchId: dismissedBatch,
                    hidden: false,
                  })
                }
              >
                {t("quickCreate.undoDismiss")}
              </Button>
            </div>
          )}
          {historyChange.isError && (
            <p role="alert" className="text-xs text-destructive">
              {t("quickCreate.dismissError")}
            </p>
          )}
          {history.isPending ? (
            <div
              role="status"
              className="flex min-h-64 items-center justify-center gap-2 rounded-xl border bg-card text-muted-foreground"
            >
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              {t("common.loading")}
            </div>
          ) : history.isError ? (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-destructive/30 bg-card p-5"
            >
              <p className="text-sm text-destructive">
                {t("quickCreate.historyError")}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void history.refetch()}
              >
                <RefreshCw aria-hidden="true" />
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            history.data.length === 0 && (
              <div className="flex min-h-80 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-12 text-center">
                <span className="mb-4 grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
                  <Images className="size-6" aria-hidden="true" />
                </span>
                <h3 className="text-sm font-semibold">
                  {t("quickCreate.emptyTitle")}
                </h3>
                <p className="mt-2 max-w-xs text-[13px] leading-6 text-muted-foreground">
                  {t("quickCreate.emptyDescription")}
                </p>
              </div>
            )
          )}
          {history.data?.map((batch) => (
            <BatchCard
              key={batch.id}
              batch={batch}
              onReuse={reuse}
              onPreview={setPreview}
              onRetry={setRetry}
              onDismiss={() =>
                historyChange.mutate({ batchId: batch.id, hidden: true })
              }
              dismissDisabled={historyChange.isPending}
              dismissing={
                historyChange.isPending &&
                historyChange.variables.batchId === batch.id
              }
            />
          ))}
          <div className="flex justify-end">
            <Button asChild variant="ghost" size="sm">
              <Link to={ROUTES.TASKS}>
                {t("quickCreate.allTasks")}
                <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
          </div>
        </section>
      </div>
      {preview && (
        <LibraryPreviewDialog item={preview} onClose={() => setPreview(null)} />
      )}
      {retry && (
        <TaskActionDialog
          task={retry}
          action="retry"
          onClose={() => {
            setRetry(null);
            void client.invalidateQueries({ queryKey: quickCreateKey });
          }}
          onCloseAutoFocus={() => undefined}
        />
      )}
    </div>
  );
}

function BatchCard({
  batch,
  onReuse,
  onPreview,
  onRetry,
  onDismiss,
  dismissDisabled,
  dismissing,
}: {
  batch: QuickBatch;
  onReuse: (batch: QuickBatch) => void;
  onPreview: (item: LibraryItem) => void;
  onRetry: (task: Task) => void;
  onDismiss: () => void;
  dismissDisabled: boolean;
  dismissing: boolean;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const representative =
    batch.tasks.find((task) => task.status === "running") ??
    batch.tasks.find((task) => task.status === "queued") ??
    batch.tasks.find(
      (task) => task.status === "failed" || task.status === "interrupted",
    ) ??
    batch.tasks.find((task) => task.status === "cancelled") ??
    batch.tasks[0];
  const active = batch.tasks.some(isTaskActive);
  const succeeded = batch.completedCount;
  const failed = batch.tasks.find(
    (task) => task.status === "failed" || task.status === "interrupted",
  );
  const items = new Map(batch.items.map((item) => [item.assetId, item]));
  // New requests have one task that produces every image. Keep older
  // requests with a task per image readable in the same history.
  const oneTask = batch.tasks.length === 1;
  const slots = oneTask
    ? Array.from({ length: batch.count }, (_, index) => ({
        key: String(index),
        task: batch.tasks[0],
        item: batch.items[index],
        removed: index < batch.completedCount && !batch.items[index],
      }))
    : batch.tasks.map((task) => ({
        key: task.id,
        task,
        item: items.get(task.id),
        removed: task.status === "succeeded" && !items.has(task.id),
      }));

  return (
    <article className="overflow-hidden rounded-xl border bg-card">
      <div className="flex items-start gap-3 border-b p-4">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="line-clamp-3 text-[13px] leading-6 wrap-break-word">
            {batch.prompt}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 text-xs leading-5 text-faint">
            <span>{t(`quickCreate.kinds.${batch.kind}`)}</span>
            <span aria-hidden="true">·</span>
            <span>{batch.aspectRatio}</span>
            <span aria-hidden="true">·</span>
            <span>
              {batch.kind === "image"
                ? t("quickCreate.imageCount", { count: batch.count })
                : t("quickCreate.shortDuration")}
            </span>
            <span aria-hidden="true">·</span>
            <time dateTime={batch.createdAt}>
              {new Intl.DateTimeFormat(language, {
                dateStyle: "short",
                timeStyle: "short",
              }).format(new Date(batch.createdAt))}
            </time>
          </p>
        </div>
        {representative && <TaskStatusBadge task={representative} />}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="-mt-1 -mr-1 shrink-0 text-faint hover:bg-destructive-soft hover:text-destructive"
          aria-label={t("quickCreate.dismissBatch")}
          title={t("quickCreate.dismissBatch")}
          disabled={dismissDisabled}
          onClick={onDismiss}
        >
          {dismissing ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <X aria-hidden="true" />
          )}
        </Button>
      </div>
      <div className="space-y-4 p-4">
        <div
          role="status"
          className="flex items-center gap-2 text-xs text-muted-foreground"
        >
          {active ? (
            <LoaderCircle
              className="size-3.5 animate-spin text-running motion-reduce:animate-none"
              aria-hidden="true"
            />
          ) : (
            <Check className="size-3.5" aria-hidden="true" />
          )}
          {t("quickCreate.completed", { done: succeeded, count: batch.count })}
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-3">
          {slots.map(({ key, task, item, removed }) => {
            return (
              <div
                key={key}
                className="group relative min-w-0 overflow-hidden rounded-lg border bg-background"
                style={{ aspectRatio: batch.aspectRatio.replace(":", " / ") }}
              >
                {item ? (
                  <>
                    <button
                      type="button"
                      aria-label={t("quickCreate.preview")}
                      onClick={() => onPreview(item)}
                      className="block size-full"
                    >
                      <img
                        src={item.thumbnailUrl ?? item.url}
                        alt={batch.prompt}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                      {batch.kind === "video" && (
                        <span className="absolute inset-0 m-auto grid size-10 place-items-center rounded-full bg-black/60 text-white">
                          <Film className="size-5" aria-hidden="true" />
                        </span>
                      )}
                    </button>
                    <div className="absolute right-2 bottom-2 flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={t("quickCreate.preview")}
                        onClick={() => onPreview(item)}
                      >
                        <Eye aria-hidden="true" />
                      </Button>
                      <Button variant="outline" size="icon-sm" asChild>
                        <a
                          href={downloadHref(item.url)}
                          download
                          aria-label={t("library.download")}
                        >
                          <Download aria-hidden="true" />
                        </a>
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-2 py-4 text-center text-xs text-faint">
                    {removed ? (
                      <span>{t("quickCreate.fileRemoved")}</span>
                    ) : isTaskActive(task) ? (
                      <>
                        <LoaderCircle
                          className="size-5 animate-spin text-running motion-reduce:animate-none"
                          aria-hidden="true"
                        />
                        <span>{t(`tasks.status.${task.status}`)}</span>
                      </>
                    ) : task.status === "succeeded" ? (
                      <span>{t("quickCreate.fileRemoved")}</span>
                    ) : (
                      <>
                        <span>{t(`tasks.status.${task.status}`)}</span>
                        {!oneTask && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => onRetry(task)}
                          >
                            <RefreshCw aria-hidden="true" />
                            {t("common.retry")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {failed && (
          <p className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-xs leading-5 text-destructive">
            {t(
              failed.error?.code === "reference_missing"
                ? "quickCreate.referenceMissing"
                : taskErrorKey(failed.error?.code),
            )}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onReuse(batch)}
          >
            <Pencil aria-hidden="true" />
            {t("quickCreate.reusePrompt")}
          </Button>
          {oneTask &&
            representative &&
            !active &&
            representative.status !== "succeeded" && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRetry(representative)}
              >
                <RefreshCw aria-hidden="true" />
                {t("common.retry")}
              </Button>
            )}
          {batch.items.length > 0 && (
            <Button variant="ghost" size="sm" asChild>
              <a
                href={libraryArchiveHref(batch.items.map((item) => item.id))}
                download
              >
                <Download aria-hidden="true" />
                {t("quickCreate.downloadAll")}
              </a>
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

function ChoiceGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex w-fit max-w-full flex-wrap gap-1 rounded-lg border border-input bg-background p-1"
    >
      {children}
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex min-h-8 items-center justify-center gap-2 rounded-md px-3 text-[13px] font-medium transition-colors max-tablet:min-h-10 disabled:opacity-50",
        selected
          ? "bg-accent text-foreground shadow-[inset_0_0_0_1px_var(--input)]"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
