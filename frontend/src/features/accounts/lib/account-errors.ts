import type { ParseKeys } from "i18next";

import { ApiError } from "@/lib/http";

/**
 * Translation key for an account request error.
 *
 * Known API codes get specific messages. Any other 4xx (for example request
 * validation, whose `detail` is a list without a code) means the server
 * definitely refused the request, so nothing was saved. Only network and 5xx
 * failures leave the outcome unknown and use `unknown`.
 */
export function accountErrorKey<
  Unknown extends ParseKeys,
  Rejected extends ParseKeys,
>(
  error: unknown,
  { unknown, rejected }: { unknown: Unknown; rejected: Rejected },
) {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "account_exists":
        return "accounts.errors.duplicate" as const;
      case "missing_session":
        return "accounts.errors.missingSession" as const;
      case "invalid_cookies":
        return "accounts.errors.format" as const;
      case "account_busy":
        return "accounts.operationMessages.account_busy" as const;
    }
    if (error.kind === "http" && error.status >= 400 && error.status < 500)
      return rejected;
  }
  return unknown;
}
