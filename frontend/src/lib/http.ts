export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly kind: "http" | "network" | "invalidResponse";

  constructor(
    status: number,
    kind: "http" | "network" | "invalidResponse" = "http",
    code?: string,
  ) {
    super(`API request failed: ${kind} (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.kind = kind;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function requestJson(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const headers = new Headers(options.headers);
  headers.set("Accept", "application/json");
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");

  let response: Response;
  try {
    response = await fetch(path, { ...options, headers });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(0, "network");
  }

  if (!response.ok) {
    // The body is optional context. Still let a cancellation that happens
    // while it streams surface as an AbortError, not an HTTP failure.
    const body = await response.json().catch((error: unknown) => {
      if (isAbortError(error)) throw error;
      return null;
    });
    const code =
      typeof body?.detail?.code === "string" ? body.detail.code : undefined;
    throw new ApiError(response.status, "http", code);
  }
  if (response.status === 204) return undefined;
  try {
    return await response.json();
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ApiError(response.status, "invalidResponse");
  }
}
