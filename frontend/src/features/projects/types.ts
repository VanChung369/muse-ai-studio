import type { z } from "zod";

import type {
  PROJECT_FILTERS,
  PROJECT_SORTS,
  PROJECT_STATUSES,
} from "./constants";
import type { projectRenderSchema } from "./api/render";
import type {
  featuredProjectSchema,
  projectDraftSchema,
  projectSchema,
  projectSummarySchema,
  projectScriptDraftSchema,
} from "./schemas";

export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type FeaturedProject = z.infer<typeof featuredProjectSchema>;
export type ProjectScriptDraft = z.infer<typeof projectScriptDraftSchema>;
export type ProjectDraft = z.infer<typeof projectDraftSchema>;
export type ProjectRender = z.infer<typeof projectRenderSchema>;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectFilter = (typeof PROJECT_FILTERS)[number];
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export type ProjectListParams = {
  q: string;
  status: ProjectFilter;
  sort: ProjectSort;
};
