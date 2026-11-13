import type { ProjectListParams } from "../types";

export const projectKeys = {
  // Prefix for every list query, used to invalidate all filters at once.
  lists: ["projects", "list"] as const,
  list: (params: ProjectListParams) =>
    [...projectKeys.lists, params] as const,
  detail: (id: string) => ["projects", "detail", id] as const,
};
