import { Clapperboard, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { isScriptEditable } from "../lib/project-script";
import type { Project } from "../types";
import { ProjectScriptEditor } from "./project-script-editor";

export function ProjectScriptSection({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const hasScript = project.scenes.length > 0;
  const canEdit = isScriptEditable(project.status);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">
          {t("projects.details.script")}
        </h3>
        {canEdit && (
          <Button variant="outline" onClick={() => setEditing(true)}>
            {hasScript ? (
              <Pencil aria-hidden="true" />
            ) : (
              <Plus aria-hidden="true" />
            )}
            {t(hasScript ? "projects.script.edit" : "projects.script.create")}
          </Button>
        )}
      </div>
      {project.characterBible && (
        <div>
          <h4 className="mb-2 text-xs font-semibold">
            {t("projects.script.characters")}
          </h4>
          <p className="text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
            {project.characterBible}
          </p>
        </div>
      )}
      {project.visualStyle && (
        <div>
          <h4 className="mb-2 text-xs font-semibold">
            {t("projects.script.visualStyle")}
          </h4>
          <p className="text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
            {project.visualStyle}
          </p>
        </div>
      )}
      {hasScript ? (
        <ol className="space-y-3">
          {project.scenes.map((scene) => (
            <li key={scene.number} className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-primary">
                <span>
                  {t("projects.details.scene", { number: scene.number })}
                </span>
                <span>
                  {t("projects.script.seconds", {
                    count: scene.durationSeconds,
                  })}
                </span>
              </div>
              <h4 className="mt-1 text-sm font-medium wrap-break-word">
                {scene.title}
              </h4>
              <p className="mt-2 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                {scene.prompt}
              </p>
              {scene.narration && (
                <div className="mt-3 border-t pt-3">
                  <h5 className="text-xs text-faint">
                    {t("projects.script.narration")}
                  </h5>
                  <p className="mt-1 text-xs leading-5 whitespace-pre-wrap text-muted-foreground">
                    {scene.narration}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-dashed p-5 text-sm text-faint">
          <Clapperboard className="size-5 shrink-0" aria-hidden="true" />
          {t("projects.details.noScript")}
        </div>
      )}
      {!canEdit && (
        <p className="text-xs leading-5 text-faint">
          {t("projects.script.locked")}
        </p>
      )}
      {editing && (
        <ProjectScriptEditor
          project={project}
          onClose={() => setEditing(false)}
        />
      )}
    </section>
  );
}
