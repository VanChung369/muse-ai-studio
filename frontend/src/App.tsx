import { lazy, type ComponentType } from "react";
import { Navigate, Route, Routes } from "react-router";

import { navigationItems, type NavigationItem } from "@/app/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import { NotFoundPage } from "@/pages/not-found-page";
import { WorkspacePage } from "@/pages/workspace-page";
import { NOT_FOUND_ROUTE, ROUTES } from "@/constants/routes";

// Feature pages that are built. Every other navigation item renders the
// WorkspacePage placeholder. AppLayout wraps the outlet in one Suspense.
const featurePages: Partial<Record<NavigationItem["id"], ComponentType>> = {
  tasks: lazy(() =>
    import("@/pages/tasks-page").then((module) => ({
      default: module.TasksPage,
    })),
  ),
  accounts: lazy(() =>
    import("@/pages/accounts-page").then((module) => ({
      default: module.AccountsPage,
    })),
  ),
    projects: lazy(() =>
    import("@/pages/projects-page").then((module) => ({
      default: module.ProjectsPage,
    })),
  ),
  library: lazy(() =>
    import("@/pages/library-page").then((module) => ({
      default: module.LibraryPage,
    })),
  ),
};

// A project opened as a workspace: one layout, one page per step.
const ProjectWorkspaceLayout = lazy(() =>
  import("@/pages/project-workspace-layout").then((module) => ({
    default: module.ProjectWorkspaceLayout,
  })),
);
const ProjectWorkspaceIndex = lazy(() =>
  import("@/pages/project-workspace-layout").then((module) => ({
    default: module.ProjectWorkspaceIndex,
  })),
);
const ProjectIdeaPage = lazy(() =>
  import("@/pages/project-idea-page").then((module) => ({
    default: module.ProjectIdeaPage,
  })),
);
const ProjectScriptPage = lazy(() =>
  import("@/pages/project-script-page").then((module) => ({
    default: module.ProjectScriptPage,
  })),
);
const ProjectRenderPage = lazy(() =>
  import("@/pages/project-render-page").then((module) => ({
    default: module.ProjectRenderPage,
  })),
);
const OutputPage = lazy(() =>
  import("@/pages/output-page").then((module) => ({
    default: module.OutputPage,
  })),
);

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={ROUTES.PROJECTS} replace />} />
        {navigationItems.map((page) => {
          const FeaturePage = featurePages[page.id];
          return (
            <Route
              key={page.path}
              path={page.path}
              element={
                FeaturePage ? <FeaturePage /> : <WorkspacePage page={page} />
              }
            />
          );
        })}
        <Route
          path={`${ROUTES.PROJECTS}/:projectId`}
          element={<ProjectWorkspaceLayout />}
        >
          <Route index element={<ProjectWorkspaceIndex />} />
          <Route path="idea" element={<ProjectIdeaPage />} />
          <Route path="script" element={<ProjectScriptPage />} />
          <Route path="render" element={<ProjectRenderPage />} />
          <Route path="output" element={<OutputPage />} />
        </Route>
        <Route path={NOT_FOUND_ROUTE} element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
