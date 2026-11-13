import type { Project, ProjectScriptDraft, ProjectStatus } from "../types";

// Mirrors the server rule for PUT /api/projects/{id}/script.
export function isScriptEditable(status: ProjectStatus): boolean {
  return status === "draft" || status === "ready";
}

export function createSceneOutline(durationSeconds: number) {
  return Array.from(
    { length: Math.ceil(durationSeconds / 10) },
    (_, index) => ({
      title: "",
      prompt: "",
      narration: "",
      durationSeconds: Math.min(10, durationSeconds - index * 10),
    }),
  );
}

export function getScriptDraft(project: Project): ProjectScriptDraft {
  return {
    expectedRevision: project.scriptRevision,
    characterBible: project.characterBible,
    visualStyle: project.visualStyle,
    scenes: project.scenes.length
      ? project.scenes.map(({ title, prompt, durationSeconds, narration }) => ({
          title,
          prompt,
          durationSeconds,
          narration,
        }))
      : createSceneOutline(project.durationSeconds),
  };
}
