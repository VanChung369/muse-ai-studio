import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { useLanguage } from "@/hooks/use-language";
import { useNow } from "@/hooks/use-now";
import { ApiError } from "@/lib/http";
import { formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { revealApiKey } from "../api/api-keys";
import { apiKeyKeys } from "../api/query-keys";
import { useCopyClipboard } from "../hooks/use-copy-clipboard";
import { revealKeyErrorKey } from "../lib/api-key-errors";
import { formatApiDate } from "../lib/playground-format";
import type { ApiKey } from "../types";
import { ClipboardFallback } from "./clipboard-fallback";
import { RevokeApiKeyDialog } from "./revoke-api-key-dialog";

export function ApiKeyRow({
  apiKey,
  onRevoked,
}: {
  apiKey: ApiKey;
  onRevoked: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [language] = useLanguage();
  const now = useNow();
  const client = useQueryClient();
  const clipboard = useCopyClipboard();
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<unknown>(null);

  async function handleCopy() {
    if (revealing) return;
    setRevealError(null);
    setRevealing(true);
    try {
      const secret = await revealApiKey(apiKey.id);
      await clipboard.copy(secret);
    } catch (error) {
      setRevealError(error);
      if (error instanceof ApiError && error.status === 404) {
        void client.invalidateQueries({ queryKey: apiKeyKeys.list });
      }
    } finally {
      setRevealing(false);
    }
  }

  const createdFull = formatApiDate(apiKey.createdAt, language);
  const lastUsedLabel = apiKey.lastUsedAt
    ? formatRelativeTime(apiKey.lastUsedAt, language, now)
    : t("apiAccess.keys.neverUsed");
  const lastUsedTitle = apiKey.lastUsedAt
    ? formatApiDate(apiKey.lastUsedAt, language)
    : undefined;

  return (
    <tr
      data-key-id={apiKey.id}
      className="border-b align-middle last:border-b-0 max-tablet:grid max-tablet:grid-cols-2 max-tablet:gap-x-4 max-tablet:gap-y-4 max-tablet:p-4 tablet:hover:bg-white/2.5 tablet:[&>td]:px-4 tablet:[&>td]:py-3"
    >
      <Cell className="max-tablet:col-span-2">
        <p className="font-medium wrap-anywhere">{apiKey.name}</p>
        {revealError !== null && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {t(revealKeyErrorKey(revealError))}
          </p>
        )}
        {clipboard.failedText !== null && (
          <ClipboardFallback
            text={clipboard.failedText}
            onDismiss={clipboard.clearFallback}
          />
        )}
      </Cell>

      <Cell label={t("apiAccess.fields.masked")}>
        <code className="font-mono text-xs wrap-anywhere text-muted-foreground">
          {apiKey.masked}
        </code>
      </Cell>

      <Cell label={t("apiAccess.fields.created")}>
        <time
          dateTime={apiKey.createdAt}
          title={createdFull}
          className="text-xs text-muted-foreground"
        >
          {formatRelativeTime(apiKey.createdAt, language, now)}
        </time>
      </Cell>

      <Cell label={t("apiAccess.fields.lastUsed")}>
        {apiKey.lastUsedAt ? (
          <time
            dateTime={apiKey.lastUsedAt}
            title={lastUsedTitle}
            className="text-xs text-muted-foreground"
          >
            {lastUsedLabel}
          </time>
        ) : (
          <span className="text-xs text-faint">{lastUsedLabel}</span>
        )}
      </Cell>

      <Cell className="max-tablet:col-span-2">
        <div className="flex flex-wrap items-center gap-1.5 tablet:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={revealing}
            aria-label={t("apiAccess.keys.copyForKey", { name: apiKey.name })}
            onClick={() => void handleCopy()}
          >
            {revealing ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : clipboard.copied ? (
              <Check className="text-success" aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
            <span>
              {clipboard.copied
                ? t("apiAccess.clipboard.copied")
                : t("apiAccess.clipboard.copy")}
            </span>
            <span className="sr-only" role="status" aria-live="polite">
              {clipboard.copied ? t("apiAccess.clipboard.copied") : ""}
            </span>
          </Button>
          <RevokeApiKeyDialog apiKey={apiKey} onRevoked={onRevoked} />
        </div>
      </Cell>
    </tr>
  );
}

function Cell({
  label,
  className,
  children,
}: {
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <td className={cn("min-w-0 max-tablet:block", className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-faint tablet:hidden">
          {label}
        </span>
      )}
      {children}
    </td>
  );
}
