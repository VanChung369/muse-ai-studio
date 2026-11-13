import { Navigate, Route, Routes } from "react-router";

import { navigationItems } from "@/app/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import { NotFoundPage } from "@/pages/not-found-page";
import { WorkspacePage } from "@/pages/workspace-page";
import { NOT_FOUND_ROUTE, ROUTES } from "@/constants/routes";

function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={ROUTES.PROJECTS} replace />} />
        {navigationItems.map((page) => (
          <Route
            key={page.path}
            path={page.path}
            element={<WorkspacePage page={page} />}
          />
        ))}
        <Route path={NOT_FOUND_ROUTE} element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

export default App;
