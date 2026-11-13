export const ROUTES = {
  ROOT: "/",
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
  NOT_FOUND: "*",
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
