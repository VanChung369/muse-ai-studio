export const ROUTES = {
  OVERVIEW: "/overview",
  PROJECTS: "/projects",
  CREATE: "/create",
  LIBRARY: "/library",
  TASKS: "/tasks",
  ACCOUNTS: "/accounts",
  API: "/api",
  PLAYGROUND: "/playground",
  DOCS: "/docs",
  SETTINGS: "/settings",
} as const;

export const NOT_FOUND_ROUTE = "*";

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
