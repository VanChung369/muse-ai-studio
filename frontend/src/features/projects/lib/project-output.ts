import type { Project, TimelineItem } from "../types";

export type FilmSegment = {
  scene: number;
  title: string;
  // Where the scene starts in the film, and how long it plays.
  offset: number;
  length: number;
};

/** The film as the timeline lays it out: kept scenes in play order. */
export function filmSegments(items: TimelineItem[]): FilmSegment[] {
  let offset = 0;
  return items
    .filter((item) => item.enabled)
    .map((item) => {
      const segment = {
        scene: item.scene,
        title: item.title,
        offset,
        length: item.end - item.start,
      };
      offset += segment.length;
      return segment;
    });
}

export function segmentAt(segments: FilmSegment[], time: number) {
  return (
    segments.findLast((segment) => time >= segment.offset - 0.01) ??
    segments[0]
  );
}

/** Seconds between ruler marks, so a film of any length gets a readable ruler. */
export function rulerStep(total: number) {
  return [1, 2, 5, 10, 15, 30, 60].find((step) => total / step <= 12) ?? 120;
}

export function rulerMarks(total: number) {
  const step = rulerStep(total);
  return Array.from(
    { length: Math.floor(total / step) + 1 },
    (_, index) => index * step,
  );
}

const safeFileName = (name: string) =>
  name.replace(/[\\/:*?"<>|]+/g, " ").trim() || "project";

/** The script as a Markdown document, built from the project in the browser. */
export function scriptMarkdown(
  project: Project,
  labels: {
    idea: string;
    characters: string;
    visualStyle: string;
    scene: (number: number) => string;
    narration: string;
  },
) {
  const parts = [`# ${project.name}`];
  if (project.idea) parts.push(`## ${labels.idea}`, project.idea);
  if (project.characterBible)
    parts.push(`## ${labels.characters}`, project.characterBible);
  if (project.visualStyle)
    parts.push(`## ${labels.visualStyle}`, project.visualStyle);
  for (const scene of project.scenes) {
    parts.push(
      `## ${labels.scene(scene.number)} · ${scene.title} (${scene.durationSeconds}s)`,
      scene.prompt,
    );
    if (scene.narration) parts.push(`> ${labels.narration}: ${scene.narration}`);
  }
  return parts.join("\n\n") + "\n";
}

export function promptsJson(project: Project) {
  return JSON.stringify(
    project.scenes.map(
      ({ number, title, durationSeconds, prompt, narration }) => ({
        scene: number,
        title,
        durationSeconds,
        prompt,
        narration,
      }),
    ),
    null,
    2,
  );
}

/** Save text the browser already holds as a file. */
export function downloadText(
  project: Project,
  extension: string,
  text: string,
  mime: string,
) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFileName(project.name)}.${extension}`;
  link.click();
  URL.revokeObjectURL(url);
}
