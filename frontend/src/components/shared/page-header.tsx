import type { ReactNode } from "react";
import { ActionBar } from "@/components/ui/action-bar";

// Matches .ph in design/design-system/muse.css.
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.01em]">
          {title}
        </h1>
        <p className="mt-1 max-w-160 text-sm leading-[1.55] text-muted-foreground">
          {description}
        </p>
      </div>
      {actions && (
        <ActionBar className="ml-auto">{actions}</ActionBar>
      )}
    </div>
  );
}
