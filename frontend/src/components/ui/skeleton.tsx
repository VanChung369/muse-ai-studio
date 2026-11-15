import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/**
 * Placeholder box matching loaded content geometry while data is pending.
 */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "rounded-md bg-accent/60 motion-safe:animate-pulse",
        className,
      )}
      {...props}
    />
  );
}
