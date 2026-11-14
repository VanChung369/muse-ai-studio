import { ApiError } from "@/lib/http";

export function createKeyErrorKey(error: unknown) {
  if (error instanceof ApiError) {
    if (error.kind === "network") return "apiAccess.errors.network" as const;
    if (error.code === "too_many_keys")
      return "apiAccess.errors.tooManyKeys" as const;
    if (error.status === 422) return "apiAccess.errors.invalidName" as const;
  }
  return "apiAccess.errors.create" as const;
}

export function revealKeyErrorKey(error: unknown) {
  if (error instanceof ApiError) {
    if (error.kind === "network") return "apiAccess.errors.network" as const;
    if (error.code === "api_key_not_found" || error.status === 404)
      return "apiAccess.errors.notFound" as const;
  }
  return "apiAccess.errors.reveal" as const;
}

export function revokeKeyErrorKey(error: unknown) {
  if (error instanceof ApiError && error.kind === "network") {
    return "apiAccess.errors.network" as const;
  }
  return "apiAccess.errors.revoke" as const;
}
