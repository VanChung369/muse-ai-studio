import { Clapperboard } from "lucide-react";

import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PROJECT_COVER_CLASSES } from "../constants";
import type { Project } from "../types";

export function ProjectCover({
  project,
  className,
}: {
  project: Project;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative grid aspect-video w-full place-items-center overflow-hidden rounded-lg bg-background",
        className,
      )}
    >
      {project.status === "draft" ? (
        <Clapperboard className="size-8 text-input" />
      ) : (
        <div
          style={{ aspectRatio: project.aspectRatio.replace(":", "/") }}
          className={cn(
            "relative h-full max-w-full",
            PROJECT_COVER_CLASSES[project.coverTone],
          )}
        >
          <span className="absolute inset-x-0 bottom-[30%] h-px bg-white/8" />
          <span className="absolute inset-0 bg-linear-to-t from-black/35 to-transparent" />
        </div>
      )}
      <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] leading-none text-white">
        {formatDuration(project.durationSeconds)}
      </span>
    </div>
  );
}
