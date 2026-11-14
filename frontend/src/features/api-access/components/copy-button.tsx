import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

export function CopyButton({
  copied,
  onCopy,
  label,
  copiedLabel,
  size = "sm",
  variant = "outline",
  disabled = false,
  className,
}: {
  copied: boolean;
  onCopy: () => void;
  label?: string;
  copiedLabel?: string;
  size?: "xs" | "sm" | "default";
  variant?: "outline" | "ghost" | "secondary";
  disabled?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const text = copied
    ? (copiedLabel ?? t("apiAccess.clipboard.copied"))
    : (label ?? t("apiAccess.clipboard.copy"));

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={onCopy}
      className={className}
    >
      {copied ? (
        <Check className="text-success" aria-hidden="true" />
      ) : (
        <Copy aria-hidden="true" />
      )}
      <span>{text}</span>
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? (copiedLabel ?? t("apiAccess.clipboard.copied")) : ""}
      </span>
    </Button>
  );
}
