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

export function isScriptProposalApplied(project: Project, proposal: ProjectScriptDraft | undefined): boolean {
  return proposal !== undefined && project.scriptRevision > proposal.expectedRevision &&
    project.characterBible === proposal.characterBible && project.visualStyle === proposal.visualStyle &&
    project.scenes.length === proposal.scenes.length && project.scenes.every((scene, index) => {
      const candidate = proposal.scenes[index];
      return scene.title === candidate.title && scene.prompt === candidate.prompt &&
        scene.durationSeconds === candidate.durationSeconds && scene.narration === candidate.narration;
    });
}
