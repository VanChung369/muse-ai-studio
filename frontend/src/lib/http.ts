export class ApiError extends Error {
  readonly status: number;
  readonly kind: "http" | "network" | "invalidResponse";

  constructor(
    status: number,
    kind: "http" | "network" | "invalidResponse" = "http",
  ) {
    super(`API request failed: ${kind} (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.kind = kind;
  }
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
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ApiError(0, "network");
  }

  if (!response.ok) throw new ApiError(response.status);
  try {
    return await response.json();
  } catch {
    throw new ApiError(response.status, "invalidResponse");
  }
}
