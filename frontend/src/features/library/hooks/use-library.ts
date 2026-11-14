import {
  keepPreviousData,
  useInfiniteQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useState } from "react";

import {
  deleteLibraryAsset,
  fetchLibrary,
  libraryKeys,
  type LibraryFilters,
  type LibraryPage,
  uploadToLibrary,
} from "../api/library";
import { libraryErrorKey, type LibraryErrorKey } from "../lib/library";

const EMPTY_COUNTS: LibraryPage["counts"] = {
  all: 0,
  image: 0,
  video: 0,
  audio: 0,
};

export function useLibrary(filters: LibraryFilters) {
  const client = useQueryClient();
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<LibraryErrorKey | null>(null);

  const query = useInfiniteQuery({
    queryKey: libraryKeys.list(filters),
    queryFn: ({ pageParam, signal }) =>
      fetchLibrary(filters, pageParam, signal),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.items.length === 0) return undefined;
      const loaded = allPages.reduce(
        (sum, page) => sum + page.items.length,
        0,
      );
      return loaded < lastPage.total ? loaded : undefined;
    },
    placeholderData: keepPreviousData,
    retry: false,
  });

  const pages = query.data?.pages ?? [];
  const seen = new Set<string>();
  // Offset pages can shift when uploads arrive between fetches; drop duplicates.
  const items = pages
    .flatMap((page) => page.items)
    .filter((item) => !seen.has(item.id) && seen.add(item.id));
  const firstPage = pages[0];
  const total = firstPage?.total ?? 0;
  const counts = firstPage?.counts ?? EMPTY_COUNTS;

  async function upload(files: File[]): Promise<number> {
    if (files.length === 0) return 0;
    setError(null);
    setUploading(true);
    let failed = 0;

    try {
      for (const file of files) {
        try {
          await uploadToLibrary(file);
        } catch (err) {
          failed += 1;
          setError(libraryErrorKey(err));
        }
      }
    } finally {
      setUploading(false);
      await client.invalidateQueries({ queryKey: libraryKeys.all });
    }

    return failed;
  }

  async function remove(assetIds: string[]): Promise<number> {
    if (assetIds.length === 0) return 0;
    setError(null);
    setRemoving(true);
    let failed = 0;

    try {
      for (const assetId of assetIds) {
        try {
          await deleteLibraryAsset(assetId);
        } catch (err) {
          failed += 1;
          setError(libraryErrorKey(err));
        }
      }
    } finally {
      setRemoving(false);
      await client.invalidateQueries({ queryKey: libraryKeys.all });
    }

    return failed;
  }

  function clearError() {
    setError(null);
  }

  return {
    query,
    items,
    total,
    counts,
    upload,
    uploading,
    remove,
    removing,
    error,
    clearError,
  };
}
