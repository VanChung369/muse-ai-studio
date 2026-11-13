import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

// Keep secondary actions before the primary action in DOM and visual order.
// Wrap on narrow screens without reversing the group or changing alignment.
export function ActionBar({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="action-bar"
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
      {...props}
    />
  );
}
