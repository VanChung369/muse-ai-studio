import type { ComponentProps } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { MAX_COOKIE_TEXT } from "../constants";

// Shared by import and cookie replacement. Long unbroken cookie values wrap
// inside the field, and its height is capped so a full export stays usable.
export function CookieTextarea({
  className,
  ...props
}: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      rows={6}
      maxLength={MAX_COOKIE_TEXT}
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="none"
      {...props}
      className={cn(
        "max-h-64 overflow-y-auto font-mono text-xs leading-5 break-all",
        className,
      )}
    />
  );
}
