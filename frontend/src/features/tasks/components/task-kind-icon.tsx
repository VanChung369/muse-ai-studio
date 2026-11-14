import { Activity, Clapperboard, Film, Image, Sparkles } from "lucide-react";

const icons: Record<string, typeof Activity> = {
  plan_script: Sparkles,
  render_scene: Clapperboard,
  merge_video: Film,
  generate_image: Image,
  generate_video: Film,
};

export function TaskKindIcon({ kind }: { kind: string }) {
  const Icon = icons[kind] ?? Activity;
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
