import { cn } from "@/lib/utils";
import type { ProjectRender } from "../types";

const SEGMENT_CLASSES = {
  queued: "bg-accent",
  running: "relative overflow-hidden bg-running-soft",
  succeeded: "bg-success",
  failed: "bg-destructive",
  interrupted: "bg-destructive",
  cancelled: "bg-surface-4",
} as const;

// One segment per scene and a last one for the merge; no percentage is shown
// because Muse does not report one.
export function RenderProgressBar({ render }: { render: ProjectRender }) {
  const segments = [...render.scenes.map((scene) => scene.task), render.merge];

  return (
    <div className="flex h-1.5 gap-0.5" aria-hidden="true">
      {segments.map((task, index) => (
        <span
          key={index}
          className={cn(
            "flex-1 rounded-xs",
            SEGMENT_CLASSES[task?.status ?? "queued"],
          )}
        >
          {task?.status === "running" && (
            // A bar sliding across the segment being worked on. With reduced
            // motion it fades in place instead, so progress is still visible.
            <span className="absolute inset-y-0 left-0 w-2/5 rounded-xs bg-running motion-safe:animate-indeterminate motion-reduce:w-full motion-reduce:animate-pulse" />
          )}
        </span>
      ))}
    </div>
  );
}
