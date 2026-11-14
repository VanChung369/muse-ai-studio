import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export function ClipboardFallback({
  text,
  multiline = false,
  onDismiss,
}: {
  text: string;
  multiline?: boolean;
  onDismiss?: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const element = multiline ? textareaRef.current : inputRef.current;
    if (!element) return;
    element.focus();
    element.select();
  }, [multiline, text]);

  return (
    <div
      role="region"
      aria-labelledby={`${id}-msg`}
      className="mt-2 space-y-2 rounded-lg border border-warning/40 bg-warning-soft p-3"
    >
      <div className="flex items-start justify-between gap-2">
        <p id={`${id}-msg`} className="text-xs leading-5 text-warning">
          {t("apiAccess.clipboard.failed")}
        </p>
        {onDismiss && (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("common.close")}
            onClick={onDismiss}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </div>
      <label htmlFor={`${id}-field`} className="sr-only">
        {t("apiAccess.clipboard.manualLabel")}
      </label>
      {multiline ? (
        <Textarea
          ref={textareaRef}
          id={`${id}-field`}
          readOnly
          value={text}
          rows={4}
          onFocus={(event) => event.currentTarget.select()}
          className="scroll-subtle min-h-20 bg-background font-mono text-xs leading-5"
        />
      ) : (
        <Input
          ref={inputRef}
          id={`${id}-field`}
          type="text"
          readOnly
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          className="bg-background font-mono text-xs"
        />
      )}
    </div>
  );
}
