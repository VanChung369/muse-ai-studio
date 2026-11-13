import type { ComponentProps } from "react";

import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

// Shared by import and cookie replacement. Long unbroken cookie values wrap
// inside the field, and its height is capped so a full export stays usable.
export function CookieTextarea({
  className,
  ...props
}: ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      // No maxLength: the browser would silently cut a large paste (breaking
      // JSON or dropping hatch_sess). The form schema reports oversize input.
      rows={6}
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
