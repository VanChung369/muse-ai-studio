import { ArrowRight, Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useOutletContext } from "react-router";

import { Button } from "@/components/ui/button";
import { ProjectSettingsForm } from "@/features/projects/components/project-settings-form";
import { projectStepHref } from "@/features/projects/lib/project-list";
import type { Project } from "@/features/projects/types";

// Step 1 of a project, "Ý tưởng" (design board 11): what the film is about
// in the main column; its overview, render options and the way on to the
// script beside it.
export function ProjectIdeaPage() {
  const { t } = useTranslation();
  const project = useOutletContext<Project>();
  const [savedForId, setSavedForId] = useState<string | null>(null);
  const saved = savedForId === project.id;

  return (
    <div
      // The note about a save goes away at the next edit.
      onChangeCapture={() => {
        if (saved) setSavedForId(null);
      }}
    >
      <ProjectSettingsForm
        key={project.id}
        layout="page"
        project={project}
        onSaved={() => setSavedForId(project.id)}
      >
        {saved && (
          <p
            role="status"
            className="flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-[13px] text-success"
          >
            <Check className="size-4 shrink-0" aria-hidden="true" />
            {t("projects.workspace.idea.saved")}
          </p>
        )}
        <Button variant="outline" asChild className="w-full">
          <Link to={projectStepHref(project.id, "script")}>
            {t("projects.workspace.idea.toScript")}
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      </ProjectSettingsForm>
    </div>
  );
}
