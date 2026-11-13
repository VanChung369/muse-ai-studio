import { API_ENDPOINTS } from "@/constants/api";
import { ApiError, requestJson } from "@/lib/http";
import { projectReferenceSchema } from "../schemas";

const referencesPath = (projectId: string) =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(projectId)}/references`;

/** Upload one picture or video as reference material for a project. */
export async function uploadReference({
  projectId,
  file,
}: {
  projectId: string;
  file: File;
}) {
  // The file is the raw body: its type travels in Content-Type and its
  // name in the query, so no multipart encoding is involved.
  const search = new URLSearchParams({ name: file.name });
  return projectReferenceSchema.parse(
    await requestJson(`${referencesPath(projectId)}?${search}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    }),
  );
}

export async function deleteReference({
  projectId,
  referenceId,
}: {
  projectId: string;
  referenceId: string;
}): Promise<void> {
  try {
    await requestJson(
      `${referencesPath(projectId)}/${encodeURIComponent(referenceId)}`,
      { method: "DELETE" },
    );
  } catch (error) {
    // Already gone (another tab, or a lost first response) is fine.
    if (error instanceof ApiError && error.status === 404) return;
    throw error;
  }
}
