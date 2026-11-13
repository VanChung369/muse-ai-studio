import type { z } from "zod";
import type {
  accountImportSchema,
  accountListSchema,
  accountSchema,
} from "./schemas";
import type { ACCOUNT_FILTERS, ACCOUNT_STATUSES } from "./constants";

export type Account = z.infer<typeof accountSchema>;
export type AccountImport = z.infer<typeof accountImportSchema>;
export type AccountList = z.infer<typeof accountListSchema>;
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number];
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];
export type AccountPatch = {
  label?: string;
  enabled?: boolean;
  notes?: string;
};
export type AccountOperation = "test" | "keep-alive" | "quota";
export type AccountEditMode = "rename" | "notes" | "cookies" | "proxy";
export type AccountEditValues = {
  label: string;
  notes: string;
  cookieText: string;
  server: string;
  username: string;
  password: string;
  // Send an empty password to remove the saved one (same server/username).
  clearPassword: boolean;
};
