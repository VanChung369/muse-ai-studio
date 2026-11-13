import { Activity, Sparkles } from "lucide-react";

export function TaskKindIcon({ kind }: { kind: string }) {
  const Icon = kind === "plan_script" ? Sparkles : Activity;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
