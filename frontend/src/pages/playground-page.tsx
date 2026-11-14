import {
  AlertTriangle,
  Info,
  KeyRound,
  LoaderCircle,
  Play,
  Square,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/constants/routes";
import { revealApiKey } from "@/features/api-access/api/api-keys";
import { ClipboardFallback } from "@/features/api-access/components/clipboard-fallback";
import { CodeBlock } from "@/features/api-access/components/code-block";
import { CopyButton } from "@/features/api-access/components/copy-button";
import { PlaygroundMediaPreview } from "@/features/api-access/components/playground-media-preview";
import {
  CHAT_MODELS,
  IMAGE_COUNTS,
  IMAGE_RESPONSE_FORMATS,
  IMAGE_SHAPES,
  MAX_PROMPT_LENGTH,
  PLAYGROUND_ENDPOINTS,
  V1_ENDPOINTS,
  VIDEO_ASPECT_RATIOS,
  VIDEO_POLL_INTERVAL_MS,
} from "@/features/api-access/constants";
import { useApiKeysQuery } from "@/features/api-access/hooks/use-api-keys";
import { useCopyClipboard } from "@/features/api-access/hooks/use-copy-clipboard";
import { revealKeyErrorKey } from "@/features/api-access/lib/api-key-errors";
import {
  currentTimestampMs,
  elapsedSince,
  formatElapsedMs,
  parseOpenAiError,
  sanitizeResponseForJson,
} from "@/features/api-access/lib/playground-format";
import {
  buildPlaygroundCurl,
  buildPlaygroundRequest,
} from "@/features/api-access/lib/snippets";
import { videoGenerationSchema } from "@/features/api-access/schemas";
import type {
  ChatModel,
  ImageCount,
  ImageResponseFormat,
  ImageShape,
  PlaygroundEndpointId,
  PlaygroundError,
  PlaygroundRequestConfig,
  VideoAspectRatio,
  VideoGeneration,
} from "@/features/api-access/types";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { cn } from "@/lib/utils";

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function PlaygroundPage() {
  const { t } = useTranslation();
  const id = useId();
  useDocumentTitle(t("pages.playground.title"));

  const keysQuery = useApiKeysQuery();
  const keys = keysQuery.data;

  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [endpoint, setEndpoint] = useState<PlaygroundEndpointId>("images");
  const [prompt, setPrompt] = useState(
    "A glass of iced coffee on a window sill",
  );
  const [imageCount, setImageCount] = useState<ImageCount>(1);
  const [imageSize, setImageSize] = useState<ImageShape["size"]>("1024x1024");
  const [responseFormat, setResponseFormat] =
    useState<ImageResponseFormat>("url");
  const [videoRatio, setVideoRatio] = useState<VideoAspectRatio>("16:9");
  const [chatModel, setChatModel] = useState<ChatModel>("muse-image");
  const [chatStream, setChatStream] = useState(false);

  const [resultTab, setResultTab] = useState<"preview" | "json">("preview");
  const [isRunning, setIsRunning] = useState(false);
  const [stoppedByUser, setStoppedByUser] = useState(false);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [taskIdHeader, setTaskIdHeader] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<
    VideoGeneration["status"] | null
  >(null);
  const [streamingText, setStreamingText] = useState("");
  const [responseData, setResponseData] = useState<unknown>(null);
  const [requestError, setRequestError] = useState<PlaygroundError | null>(
    null,
  );
  // Keep endpoint snapshot of the last sent request for rendering Preview safely.
  const [activeEndpoint, setActiveEndpoint] =
    useState<PlaygroundEndpointId>("images");

  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | undefined>(undefined);
  const curlCopy = useCopyClipboard();

  const effectiveKeyId =
    keys && keys.some((key) => key.id === selectedKeyId)
      ? selectedKeyId
      : (keys?.[0]?.id ?? "");

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (timerRef.current !== undefined) {
        window.clearInterval(timerRef.current);
      }
    };
  }, []);

  const config: PlaygroundRequestConfig =
    endpoint === "images"
      ? {
          endpoint: "images",
          prompt,
          n: imageCount,
          size: imageSize,
          responseFormat,
        }
      : endpoint === "videos"
        ? { endpoint: "videos", prompt, aspectRatio: videoRatio }
        : endpoint === "chat"
          ? {
              endpoint: "chat",
              model: chatModel,
              prompt,
              stream: chatStream,
            }
          : { endpoint: "models" };

  const builtRequest = buildPlaygroundRequest(config);
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const curlCommand = buildPlaygroundCurl(origin, config);
  const needsPrompt = endpoint !== "models";
  const canSend =
    !isRunning &&
    Boolean(effectiveKeyId) &&
    (!needsPrompt || Boolean(prompt.trim()));

  function stopTimer() {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  }

  function handleStop() {
    setStoppedByUser(true);
    abortRef.current?.abort();
    stopTimer();
    setIsRunning(false);
  }

  async function handleSend() {
    if (!canSend) return;

    abortRef.current?.abort();
    stopTimer();

    const controller = new AbortController();
    abortRef.current = controller;
    const startedAt = currentTimestampMs();

    setIsRunning(true);
    setStoppedByUser(false);
    setElapsedMs(0);
    setHttpStatus(null);
    setTaskIdHeader(null);
    setVideoStatus(null);
    setStreamingText("");
    setResponseData(null);
    setRequestError(null);
    setActiveEndpoint(endpoint);

    timerRef.current = window.setInterval(() => {
      setElapsedMs(elapsedSince(startedAt));
    }, 100);

    try {
      let apiKey: string;
      try {
        apiKey = await revealApiKey(effectiveKeyId, controller.signal);
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return;
        setRequestError({ kind: "reveal", source: error });
        return;
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
      };
      if (builtRequest.body !== null) {
        headers["Content-Type"] = "application/json";
      }

      const response = await fetch(builtRequest.path, {
        method: builtRequest.method,
        headers,
        body:
          builtRequest.body !== null
            ? JSON.stringify(builtRequest.body)
            : undefined,
        signal: controller.signal,
      });

      setHttpStatus(response.status);
      const headerTaskId = response.headers.get("X-Muse-Task-Id");
      if (headerTaskId) setTaskIdHeader(headerTaskId);

      if (!response.ok) {
        const rawText = await response.text();
        try {
          setResponseData(JSON.parse(rawText));
        } catch {
          setResponseData(rawText || null);
        }
        const openAiError = parseOpenAiError(rawText);
        if (openAiError) {
          setRequestError({
            kind: "openai",
            status: response.status,
            info: openAiError,
            taskId: headerTaskId,
          });
        } else {
          setRequestError({
            kind: "http",
            status: response.status,
            message: rawText || response.statusText,
            taskId: headerTaskId,
          });
        }
        return;
      }

      if (endpoint === "chat" && chatStream) {
        await readChatStream(response, controller.signal);
        return;
      }

      const rawText = await response.text();
      let parsed: unknown = rawText;
      try {
        parsed = JSON.parse(rawText);
      } catch {
        // Leave as text if server did not send JSON.
      }
      setResponseData(parsed);

      if (endpoint === "videos") {
        const videoParsed = videoGenerationSchema.safeParse(parsed);
        if (!videoParsed.success) return;

        let current = videoParsed.data;
        setVideoStatus(current.status);

        while (
          !controller.signal.aborted &&
          (current.status === "queued" || current.status === "in_progress")
        ) {
          await sleep(VIDEO_POLL_INTERVAL_MS, controller.signal);

          const pollResponse = await fetch(
            `${V1_ENDPOINTS.VIDEOS}/${encodeURIComponent(current.id)}`,
            {
              method: "GET",
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: controller.signal,
            },
          );

          setHttpStatus(pollResponse.status);
          const pollText = await pollResponse.text();
          let pollParsed: unknown = pollText;
          try {
            pollParsed = JSON.parse(pollText);
          } catch {
            // Keep raw text.
          }
          setResponseData(pollParsed);

          if (!pollResponse.ok) {
            const openAiError = parseOpenAiError(pollText);
            if (openAiError) {
              setRequestError({
                kind: "openai",
                status: pollResponse.status,
                info: openAiError,
              });
            } else {
              setRequestError({
                kind: "http",
                status: pollResponse.status,
                message: pollText || pollResponse.statusText,
              });
            }
            return;
          }

          const nextVideo = videoGenerationSchema.safeParse(pollParsed);
          if (!nextVideo.success) return;
          current = nextVideo.data;
          setVideoStatus(current.status);
        }

        if (current.status === "failed" && current.error) {
          setRequestError({
            kind: "openai",
            status: 200,
            info: {
              message: current.error.message,
              type: current.error.type ?? "api_error",
              code: current.error.code ?? null,
            },
          });
        }
      }
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) return;
      setRequestError({ kind: "network" });
    } finally {
      if (abortRef.current === controller) {
        stopTimer();
        setElapsedMs(elapsedSince(startedAt));
        setIsRunning(false);
      }
    }
  }

  async function readChatStream(response: Response, signal: AbortSignal) {
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      setStreamingText(text);
      return;
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let accumulated = "";
    const chunks: unknown[] = [];

    try {
      while (!signal.aborted) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.replace(/\r$/, "");
          if (!line || line.startsWith(":")) continue;
          if (!line.startsWith("data:")) continue;

          const payload = line.slice(5).trim();
          if (payload === "[DONE]") {
            setResponseData({
              object: "chat.completion.stream",
              content: accumulated,
              chunks,
            });
            return;
          }

          try {
            const chunk: unknown = JSON.parse(payload);
            chunks.push(chunk);
            const deltaText = extractChunkDeltaContent(chunk);
            if (deltaText) {
              accumulated += deltaText;
              setStreamingText(accumulated);
            }
            setResponseData({
              object: "chat.completion.stream",
              content: accumulated,
              chunks,
            });
          } catch {
            // Ignore malformed SSE lines.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  const formattedResponseJson =
    responseData === null
      ? null
      : typeof responseData === "string"
        ? responseData
        : JSON.stringify(sanitizeResponseForJson(responseData), null, 2);

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.playground.title")}
        description={t("pages.playground.description")}
      />

      <p
        role="note"
        className="mb-6 flex items-start gap-2.5 rounded-xl border border-dashed bg-card/60 px-4 py-3 text-xs leading-5 text-muted-foreground"
      >
        <Info
          className="mt-0.5 size-4 shrink-0 text-primary"
          aria-hidden="true"
        />
        <span className="min-w-0">
          {t("playground.realRequestNote")}{" "}
          <Link
            to={ROUTES.TASKS}
            className="font-medium text-foreground underline underline-offset-3 hover:text-primary"
          >
            {t("pages.tasks.title")}
          </Link>
          {" · "}
          <Link
            to={ROUTES.LIBRARY}
            className="font-medium text-foreground underline underline-offset-3 hover:text-primary"
          >
            {t("pages.library.title")}
          </Link>
        </span>
      </p>

      {keysQuery.isPending && <PageLoading />}

      {keysQuery.isError && (
        <div
          role="alert"
          className="space-y-3 rounded-xl border border-destructive/30 bg-card p-5"
        >
          <p className="text-sm text-destructive">
            {t("apiAccess.errors.load")}
          </p>
          <Button
            type="button"
            variant="outline"
            disabled={keysQuery.isFetching}
            onClick={() => void keysQuery.refetch()}
          >
            {t("common.retry")}
          </Button>
        </div>
      )}

      {keys && keys.length === 0 && (
        <section className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
          <span className="grid size-12 place-items-center rounded-xl bg-primary-soft text-primary">
            <KeyRound className="size-6" aria-hidden="true" />
          </span>
          <h2 className="text-base font-semibold">
            {t("playground.noKeys.title")}
          </h2>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            {t("playground.noKeys.description")}
          </p>
          <Button asChild className="mt-1">
            <Link to={ROUTES.API}>{t("playground.noKeys.action")}</Link>
          </Button>
        </section>
      )}

      {keys && keys.length > 0 && (
        <div className="grid items-start gap-6 desktop:grid-cols-[minmax(20rem,25rem)_minmax(0,1fr)]">
          <form
            aria-label={t("playground.formLabel")}
            className="min-w-0 space-y-5 rounded-xl border bg-card p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSend();
            }}
          >
            <fieldset disabled={isRunning} className="min-w-0 space-y-5">
              <div className="space-y-2">
                <Label htmlFor={`${id}-key`}>
                  {t("playground.fields.key")}
                </Label>
                <Select
                  value={effectiveKeyId}
                  onValueChange={setSelectedKeyId}
                  disabled={isRunning}
                >
                  <SelectTrigger id={`${id}-key`} className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.map((apiKey) => (
                      <SelectItem key={apiKey.id} value={apiKey.id}>
                        <span className="truncate">{apiKey.name}</span>
                        <span className="font-mono text-xs text-faint">
                          {apiKey.masked}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor={`${id}-endpoint`}>
                  {t("playground.fields.endpoint")}
                </Label>
                <Select
                  value={endpoint}
                  onValueChange={(value) =>
                    setEndpoint(value as PlaygroundEndpointId)
                  }
                  disabled={isRunning}
                >
                  <SelectTrigger
                    id={`${id}-endpoint`}
                    className="w-full font-mono text-xs"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAYGROUND_ENDPOINTS.map((item) => (
                      <SelectItem
                        key={item}
                        value={item}
                        className="font-mono text-xs"
                      >
                        {t(`playground.endpoints.${item}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {needsPrompt && (
                <div className="space-y-2">
                  <Label htmlFor={`${id}-prompt`}>
                    {t("playground.fields.prompt")}
                  </Label>
                  <Textarea
                    id={`${id}-prompt`}
                    value={prompt}
                    maxLength={MAX_PROMPT_LENGTH}
                    required
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder={t("playground.fields.promptPlaceholder")}
                    className="min-h-28 resize-y text-sm leading-6"
                  />
                </div>
              )}

              {endpoint === "images" && (
                <>
                  <div className="space-y-2">
                    <Label>{t("playground.fields.count")}</Label>
                    <div
                      role="group"
                      aria-label={t("playground.fields.count")}
                      className="grid grid-cols-4 gap-2"
                    >
                      {IMAGE_COUNTS.map((count) => (
                        <Button
                          key={count}
                          type="button"
                          size="sm"
                          variant={imageCount === count ? "default" : "outline"}
                          aria-pressed={imageCount === count}
                          onClick={() => setImageCount(count)}
                        >
                          {count}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("playground.fields.shape")}</Label>
                    <div
                      role="group"
                      aria-label={t("playground.fields.shape")}
                      className="grid grid-cols-3 gap-2"
                    >
                      {IMAGE_SHAPES.map((shape) => (
                        <Button
                          key={shape.id}
                          type="button"
                          size="sm"
                          variant={
                            imageSize === shape.size ? "default" : "outline"
                          }
                          aria-pressed={imageSize === shape.size}
                          onClick={() => setImageSize(shape.size)}
                          className="h-auto flex-col gap-0.5 py-2"
                        >
                          <span className="text-xs font-semibold">
                            {shape.ratio}
                          </span>
                          <span className="font-mono text-[11px] opacity-75">
                            {shape.size}
                          </span>
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{t("playground.fields.responseFormat")}</Label>
                    <div
                      role="group"
                      aria-label={t("playground.fields.responseFormat")}
                      className="grid grid-cols-2 gap-2"
                    >
                      {IMAGE_RESPONSE_FORMATS.map((fmt) => (
                        <Button
                          key={fmt}
                          type="button"
                          size="sm"
                          variant={
                            responseFormat === fmt ? "default" : "outline"
                          }
                          aria-pressed={responseFormat === fmt}
                          onClick={() => setResponseFormat(fmt)}
                          className="font-mono text-xs"
                        >
                          {fmt}
                        </Button>
                      ))}
                    </div>
                  </div>
                </>
              )}

              {endpoint === "videos" && (
                <div className="space-y-2">
                  <Label>{t("playground.fields.aspectRatio")}</Label>
                  <div
                    role="group"
                    aria-label={t("playground.fields.aspectRatio")}
                    className="grid grid-cols-3 gap-2"
                  >
                    {VIDEO_ASPECT_RATIOS.map((item) => (
                      <Button
                        key={item.id}
                        type="button"
                        size="sm"
                        variant={
                          videoRatio === item.ratio ? "default" : "outline"
                        }
                        aria-pressed={videoRatio === item.ratio}
                        onClick={() => setVideoRatio(item.ratio)}
                      >
                        {item.ratio}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {endpoint === "chat" && (
                <>
                  <div className="space-y-2">
                    <Label>{t("playground.fields.model")}</Label>
                    <div
                      role="group"
                      aria-label={t("playground.fields.model")}
                      className="grid grid-cols-2 gap-2"
                    >
                      {CHAT_MODELS.map((model) => (
                        <Button
                          key={model}
                          type="button"
                          size="sm"
                          variant={chatModel === model ? "default" : "outline"}
                          aria-pressed={chatModel === model}
                          onClick={() => setChatModel(model)}
                          className="font-mono text-xs"
                        >
                          {model}
                        </Button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border bg-background/50 px-3 py-2.5">
                    <div className="min-w-0">
                      <Label htmlFor={`${id}-stream`}>
                        {t("playground.fields.stream")}
                      </Label>
                      <p className="mt-0.5 text-xs text-faint">
                        {t("playground.fields.streamHint")}
                      </p>
                    </div>
                    <input
                      id={`${id}-stream`}
                      type="checkbox"
                      checked={chatStream}
                      onChange={(event) => setChatStream(event.target.checked)}
                      className="size-4 shrink-0 accent-primary"
                    />
                  </div>
                </>
              )}

              {endpoint === "models" && (
                <p className="rounded-lg border bg-background/50 p-3 text-xs leading-5 text-muted-foreground">
                  {t("playground.modelsHint")}
                </p>
              )}
            </fieldset>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button
                type="submit"
                disabled={!canSend}
                className="min-w-0 flex-1"
              >
                {isRunning ? (
                  <LoaderCircle
                    className="animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <Play aria-hidden="true" />
                )}
                {t(
                  isRunning
                    ? "playground.actions.sending"
                    : "playground.actions.send",
                )}
              </Button>

              {isRunning && (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleStop}
                >
                  <Square aria-hidden="true" />
                  {t("playground.actions.stop")}
                </Button>
              )}
            </div>
          </form>

          <div className="min-w-0 space-y-5">
            <section
              aria-labelledby={`${id}-request-heading`}
              className="rounded-xl border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2
                  id={`${id}-request-heading`}
                  className="text-sm font-semibold"
                >
                  {t("playground.request.title")}
                </h2>
                <CopyButton
                  copied={curlCopy.copied}
                  onCopy={() => void curlCopy.copy(curlCommand)}
                  label={t("playground.actions.copyCurl")}
                  copiedLabel={t("apiAccess.clipboard.copied")}
                  size="sm"
                  variant="outline"
                />
              </div>

              {curlCopy.failedText !== null && (
                <ClipboardFallback
                  text={curlCopy.failedText}
                  multiline
                  onDismiss={curlCopy.clearFallback}
                />
              )}

              <div className="mt-3">
                {builtRequest.body !== null ? (
                  <CodeBlock
                    code={JSON.stringify(builtRequest.body, null, 2)}
                    label={`${builtRequest.method} ${builtRequest.path}`}
                  />
                ) : (
                  <div className="rounded-lg border bg-background px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                    {builtRequest.method} {builtRequest.path}
                  </div>
                )}
              </div>
            </section>

            <section
              aria-labelledby={`${id}-response-heading`}
              className="rounded-xl border bg-card p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h2
                    id={`${id}-response-heading`}
                    className="text-sm font-semibold"
                  >
                    {t("playground.response.title")}
                  </h2>
                  {httpStatus !== null && (
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 font-mono text-xs font-medium",
                        httpStatus >= 200 && httpStatus < 300
                          ? "bg-success-soft text-success"
                          : "bg-destructive-soft text-destructive",
                      )}
                    >
                      HTTP {httpStatus}
                    </span>
                  )}
                  {videoStatus && (
                    <span
                      role="status"
                      className={cn(
                        "rounded-md px-2 py-0.5 font-mono text-xs font-medium",
                        videoStatus === "succeeded"
                          ? "bg-success-soft text-success"
                          : videoStatus === "failed" ||
                              videoStatus === "cancelled"
                            ? "bg-destructive-soft text-destructive"
                            : "bg-running-soft text-running",
                      )}
                    >
                      {t(`playground.videoStatus.${videoStatus}`)}
                    </span>
                  )}
                  {elapsedMs !== null && (
                    <span
                      role="status"
                      className="font-mono text-xs text-faint tabular-nums"
                    >
                      {formatElapsedMs(elapsedMs)}
                    </span>
                  )}
                </div>

                <div
                  role="tablist"
                  aria-label={t("playground.response.tabsLabel")}
                  className="flex gap-1.5"
                >
                  {(["preview", "json"] as const).map((tab) => (
                    <Button
                      key={tab}
                      id={`${id}-resp-tab-${tab}`}
                      type="button"
                      role="tab"
                      size="sm"
                      aria-selected={resultTab === tab}
                      aria-controls={`${id}-resp-panel-${tab}`}
                      variant={resultTab === tab ? "default" : "outline"}
                      onClick={() => setResultTab(tab)}
                    >
                      {t(`playground.response.tabs.${tab}`)}
                    </Button>
                  ))}
                </div>
              </div>

              {taskIdHeader && (
                <p className="mt-3 font-mono text-xs wrap-anywhere text-faint">
                  X-Muse-Task-Id: {taskIdHeader}
                </p>
              )}

              {stoppedByUser && (
                <div
                  role="status"
                  className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs leading-5 text-warning"
                >
                  <AlertTriangle
                    className="mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    {t("playground.stoppedNote")}{" "}
                    <Link
                      to={ROUTES.TASKS}
                      className="font-semibold underline underline-offset-3"
                    >
                      {t("pages.tasks.title")}
                    </Link>
                  </span>
                </div>
              )}

              {requestError && (
                <div
                  role="alert"
                  className="mt-4 space-y-1.5 rounded-lg border border-destructive/30 bg-destructive-soft p-3.5 text-sm text-destructive"
                >
                  {requestError.kind === "openai" && (
                    <>
                      <p className="font-medium wrap-anywhere">
                        {requestError.info.message}
                      </p>
                      <p className="font-mono text-xs opacity-90">
                        {[
                          `HTTP ${requestError.status}`,
                          requestError.info.code
                            ? `code: ${requestError.info.code}`
                            : null,
                          `type: ${requestError.info.type}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </>
                  )}
                  {requestError.kind === "http" && (
                    <>
                      <p className="font-medium">
                        {t("playground.errors.httpStatus", {
                          status: requestError.status,
                        })}
                      </p>
                      {requestError.message && (
                        <p className="text-xs wrap-anywhere opacity-90">
                          {requestError.message}
                        </p>
                      )}
                    </>
                  )}
                  {requestError.kind === "network" && (
                    <p className="font-medium">
                      {t("playground.errors.network")}
                    </p>
                  )}
                  {requestError.kind === "reveal" && (
                    <p className="font-medium">
                      {t(revealKeyErrorKey(requestError.source))}
                    </p>
                  )}
                  {(requestError.kind === "openai" ||
                    requestError.kind === "http") &&
                    requestError.taskId && (
                      <p className="font-mono text-xs opacity-90">
                        X-Muse-Task-Id: {requestError.taskId}
                      </p>
                    )}
                </div>
              )}

              <div
                id={`${id}-resp-panel-${resultTab}`}
                role="tabpanel"
                aria-labelledby={`${id}-resp-tab-${resultTab}`}
                className="mt-4"
              >
                {resultTab === "preview" ? (
                  isRunning && responseData === null && !streamingText ? (
                    <div
                      role="status"
                      className="flex min-h-40 items-center justify-center gap-2.5 rounded-lg border border-dashed text-sm text-muted-foreground"
                    >
                      <LoaderCircle
                        className="size-4 animate-spin motion-reduce:animate-none"
                        aria-hidden="true"
                      />
                      {t("playground.response.waiting")}
                    </div>
                  ) : (
                    <PlaygroundMediaPreview
                      endpoint={activeEndpoint}
                      responseData={responseData}
                      streamingText={streamingText}
                      isRunning={isRunning}
                    />
                  )
                ) : formattedResponseJson !== null ? (
                  <CodeBlock
                    code={formattedResponseJson}
                    label="application/json"
                  />
                ) : (
                  <p className="text-sm text-faint">
                    {t("playground.response.noJson")}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function extractChunkDeltaContent(chunk: unknown): string {
  if (chunk === null || typeof chunk !== "object") return "";
  const record = chunk as Record<string, unknown>;
  if (!Array.isArray(record.choices) || record.choices.length === 0) return "";
  const choice = record.choices[0];
  if (choice === null || typeof choice !== "object") return "";
  const delta = (choice as Record<string, unknown>).delta;
  if (delta === null || typeof delta !== "object") return "";
  const content = (delta as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}
