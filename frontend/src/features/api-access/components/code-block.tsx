import { cn } from "@/lib/utils";
import { useCopyClipboard } from "../hooks/use-copy-clipboard";
import { ClipboardFallback } from "./clipboard-fallback";
import { CopyButton } from "./copy-button";

export function CodeBlock({
  code,
  label,
  copyLabel,
  className,
}: {
  code: string;
  label?: string;
  copyLabel?: string;
  className?: string;
}) {
  const clipboard = useCopyClipboard();
  const multiline = code.includes("\n");

  return (
    <div className={cn("min-w-0", className)}>
      <div className="overflow-hidden rounded-lg border bg-background">
        <div className="flex items-center justify-between gap-2 border-b bg-secondary/70 px-3 py-1.5">
          <span className="min-w-0 truncate font-mono text-xs text-faint">
            {label ?? ""}
          </span>
          <CopyButton
            copied={clipboard.copied}
            onCopy={() => void clipboard.copy(code)}
            label={copyLabel}
            size="xs"
            variant="ghost"
          />
        </div>
        <pre className="scroll-subtle overflow-x-auto p-3.5 font-mono text-xs leading-6 text-foreground">
          <code>{code}</code>
        </pre>
      </div>
      {clipboard.failedText !== null && (
        <ClipboardFallback
          text={clipboard.failedText}
          multiline={multiline}
          onDismiss={clipboard.clearFallback}
        />
      )}
    </div>
  );
}
