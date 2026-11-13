import type { z } from "zod";

import type {
  PROJECT_FILTERS,
  PROJECT_SORTS,
  PROJECT_STATUSES,
} from "./constants";
import type {
  featuredProjectSchema,
  projectDraftSchema,
  projectSchema,
  projectSummarySchema,
} from "./schemas";

export type Project = z.infer<typeof projectSchema>;
export type ProjectSummary = z.infer<typeof projectSummarySchema>;
export type FeaturedProject = z.infer<typeof featuredProjectSchema>;
export type ProjectDraft = z.infer<typeof projectDraftSchema>;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectFilter = (typeof PROJECT_FILTERS)[number];
export type ProjectSort = (typeof PROJECT_SORTS)[number];

export type ProjectListParams = {
  q: string;
  status: ProjectFilter;
  sort: ProjectSort;
};
