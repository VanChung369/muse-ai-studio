import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  b64ToDataUrl,
  parseChatMediaSegments,
} from "../lib/playground-format";
import type { PlaygroundEndpointId } from "../types";

export function PlaygroundMediaPreview({
  endpoint,
  responseData,
  streamingText,
  isRunning,
}: {
  endpoint: PlaygroundEndpointId;
  responseData: unknown;
  streamingText: string;
  isRunning: boolean;
}) {
  const { t } = useTranslation();

  if (endpoint === "models") {
    const models = extractModels(responseData);
    if (models.length === 0) {
      return <EmptyPreview />;
    }
    return (
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-left text-xs">
          <thead className="border-b bg-secondary text-faint">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("playground.preview.modelId")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("playground.preview.ownedBy")}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t("playground.preview.created")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {models.map((model) => (
              <tr key={model.id}>
                <td className="px-3 py-2 font-mono font-medium">{model.id}</td>
                <td className="px-3 py-2 text-muted-foreground">
                  {model.ownedBy}
                </td>
                <td className="px-3 py-2 font-mono text-muted-foreground">
                  {model.created}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (endpoint === "images") {
    const images = extractImages(responseData);
    if (images.length === 0) {
      return <EmptyPreview />;
    }
    return (
      <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2">
        {images.map((image, index) => (
          <figure
            key={`${index}-${image.src.slice(0, 32)}`}
            className="overflow-hidden rounded-lg border bg-background"
          >
            <img
              src={image.src}
              alt={t("playground.preview.imageAlt", { index: index + 1 })}
              className="max-h-96 w-full object-contain bg-black/40"
            />
            {image.downloadUrl && (
              <figcaption className="flex items-center justify-between gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
                <span className="truncate font-mono">
                  #{index + 1}
                </span>
                <Button variant="ghost" size="xs" asChild>
                  <a href={image.downloadUrl} target="_blank" rel="noreferrer">
                    <Download aria-hidden="true" />
                    {t("playground.preview.openFile")}
                  </a>
                </Button>
              </figcaption>
            )}
          </figure>
        ))}
      </div>
    );
  }

  if (endpoint === "videos") {
    const urls = extractVideoUrls(responseData);
    if (urls.length === 0) {
      return <EmptyPreview />;
    }
    return (
      <div className="space-y-4">
        {urls.map((url, index) => (
          <div key={url} className="space-y-2">
            <video
              controls
              playsInline
              src={url}
              className="max-h-104 w-full rounded-lg border bg-black"
            />
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="truncate font-mono">
                {t("playground.preview.videoLabel", { index: index + 1 })}
              </span>
              <Button variant="ghost" size="xs" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <Download aria-hidden="true" />
                  {t("playground.preview.openFile")}
                </a>
              </Button>
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Chat endpoint
  const chatContent = extractChatContent(responseData) ?? streamingText;
  if (!chatContent) {
    return (
      <p className="text-sm text-faint">
        {isRunning
          ? t("playground.preview.waitingStream")
          : t("playground.preview.empty")}
      </p>
    );
  }

  const segments = parseChatMediaSegments(chatContent);
  return (
    <div className="space-y-4">
      {segments.map((segment, index) => {
        if (segment.type === "image") {
          return (
            <figure
              key={`${index}-${segment.url}`}
              className="overflow-hidden rounded-lg border bg-background"
            >
              <img
                src={segment.url}
                alt={segment.alt || t("playground.preview.imageAlt", { index: 1 })}
                className="max-h-96 w-full bg-black/40 object-contain"
              />
            </figure>
          );
        }
        if (segment.type === "video") {
          return (
            <video
              key={`${index}-${segment.url}`}
              controls
              playsInline
              src={segment.url}
              className="max-h-104 w-full rounded-lg border bg-black"
            />
          );
        }
        if (!segment.text.trim()) return null;
        return (
          <p
            key={index}
            className="text-sm leading-6 whitespace-pre-wrap wrap-anywhere text-foreground"
          >
            {segment.text}
          </p>
        );
      })}
    </div>
  );
}

function EmptyPreview() {
  const { t } = useTranslation();
  return <p className="text-sm text-faint">{t("playground.preview.empty")}</p>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractModels(data: unknown) {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.data)) return [];
  const items: { id: string; ownedBy: string; created: string }[] = [];
  for (const item of root.data) {
    const rec = asRecord(item);
    if (!rec || typeof rec.id !== "string") continue;
    items.push({
      id: rec.id,
      ownedBy: typeof rec.owned_by === "string" ? rec.owned_by : "—",
      created: typeof rec.created === "number" ? String(rec.created) : "—",
    });
  }
  return items;
}

function extractImages(data: unknown) {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.data)) return [];
  const items: { src: string; downloadUrl: string | null }[] = [];
  for (const item of root.data) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (typeof rec.url === "string" && rec.url) {
      items.push({ src: rec.url, downloadUrl: rec.url });
    } else if (typeof rec.b64_json === "string" && rec.b64_json) {
      items.push({ src: b64ToDataUrl(rec.b64_json), downloadUrl: null });
    }
  }
  return items;
}

function extractVideoUrls(data: unknown) {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.data)) return [];
  const urls: string[] = [];
  for (const item of root.data) {
    const rec = asRecord(item);
    if (rec && typeof rec.url === "string" && rec.url) {
      urls.push(rec.url);
    }
  }
  return urls;
}

function extractChatContent(data: unknown): string | null {
  const root = asRecord(data);
  if (!root || !Array.isArray(root.choices) || root.choices.length === 0) {
    return null;
  }
  const choice = asRecord(root.choices[0]);
  const message = choice ? asRecord(choice.message) : null;
  return message && typeof message.content === "string"
    ? message.content
    : null;
}
