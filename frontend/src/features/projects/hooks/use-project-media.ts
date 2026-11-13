import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  deleteMedia,
  fetchMedia,
  mediaKey,
  type ProjectMedia,
  uploadMedia,
} from "../api/media";
import { mediaErrorKey, type MediaErrorKey } from "../lib/project-media";

export function useProjectMedia(projectId: string) {
  const client = useQueryClient();
  const key = mediaKey(projectId);
  const [uploading, setUploading] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<MediaErrorKey | null>(null);

  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => fetchMedia(projectId, signal),
    retry: false,
  });

  async function upload(files: File[]): Promise<number> {
    if (files.length === 0) return 0;
    setError(null);
    setUploading(true);
    let failed = 0;

    try {
      for (const file of files) {
        try {
          const created = await uploadMedia({ projectId, file });
          client.setQueryData<ProjectMedia[]>(key, (current) =>
            current ? [...current, created] : [created],
          );
        } catch (err) {
          failed += 1;
          setError(mediaErrorKey(err));
        }
      }
    } finally {
      setUploading(false);
    }

    return failed;
  }

  async function remove(mediaId: string): Promise<void> {
    setError(null);
    setRemovingId(mediaId);
    try {
      await deleteMedia({ projectId, mediaId });
      client.setQueryData<ProjectMedia[]>(key, (current) =>
        current ? current.filter((item) => item.id !== mediaId) : current,
      );
    } catch (err) {
      setError(mediaErrorKey(err));
    } finally {
      setRemovingId(null);
    }
  }

  function clearError() {
    setError(null);
  }

  return {
    query,
    upload,
    uploading,
    remove,
    removingId,
    error,
    clearError,
  };
}
