import {
  Activity,
  BookOpen,
  Clapperboard,
  House,
  Images,
  KeyRound,
  Settings2,
  Sparkles,
  SquareTerminal,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { ROUTES, type AppRoute } from "@/constants/routes";
import type { TranslationResources } from "@/i18n/types";

export type NavigationItem = {
  id: keyof TranslationResources["pages"];
  path: AppRoute;
  icon: LucideIcon;
};

type NavigationGroup = {
  id: keyof TranslationResources["navigation"]["groups"];
  items: NavigationItem[];
};

export const navigationGroups: NavigationGroup[] = [
  {
    id: "workspace",
    items: [
      { id: "overview", path: ROUTES.OVERVIEW, icon: House },
      { id: "projects", path: ROUTES.PROJECTS, icon: Clapperboard },
      { id: "create", path: ROUTES.CREATE, icon: Sparkles },
      { id: "library", path: ROUTES.LIBRARY, icon: Images },
      { id: "tasks", path: ROUTES.TASKS, icon: Activity },
    ],
  },
  {
    id: "management",
    items: [
      { id: "accounts", path: ROUTES.ACCOUNTS, icon: UsersRound },
      { id: "api", path: ROUTES.API, icon: KeyRound },
      { id: "playground", path: ROUTES.PLAYGROUND, icon: SquareTerminal },
      { id: "docs", path: ROUTES.DOCS, icon: BookOpen },
    ],
  },
];

export const settingsNavigation: NavigationItem = {
  id: "settings",
  path: ROUTES.SETTINGS,
  icon: Settings2,
};

export const navigationItems: NavigationItem[] = [
  ...navigationGroups.flatMap((group) => group.items),
  settingsNavigation,
];
