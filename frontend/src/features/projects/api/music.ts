import { API_ENDPOINTS } from "@/constants/api";
import { taskSchema } from "@/features/tasks/schemas";
import { requestJson } from "@/lib/http";

export const musicKey = (projectId: string) =>
  ["projects", "music", projectId] as const;

const musicPath = (projectId: string) =>
  `${API_ENDPOINTS.PROJECTS}/${encodeURIComponent(projectId)}/media/music`;

/** The project's latest request for music made by Muse, or null. */
export async function fetchMusicTask(projectId: string, signal?: AbortSignal) {
  return taskSchema
    .nullable()
    .parse(await requestJson(musicPath(projectId), { signal }));
}

/** Ask Muse for a short piece of music; it arrives among the project's media. */
export async function requestMusic(values: {
  projectId: string;
  description: string;
}) {
  return taskSchema.parse(
    await requestJson(musicPath(values.projectId), {
      method: "POST",
      body: JSON.stringify({ description: values.description }),
    }),
  );
}
