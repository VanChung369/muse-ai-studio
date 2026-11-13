import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";

type Props = {
  shown: number;
  total: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  hasError: boolean;
  onLoadMore: () => void;
};

// "Load more" rather than numbered pages: it keeps scroll position and the
// ?project= sheet link stable, and suits a card grid.
export function ProjectListFooter({
  shown,
  total,
  hasMore,
  isLoadingMore,
  hasError,
  onLoadMore,
}: Props) {
  const { t } = useTranslation();

  return (
    <div className="mt-6 flex flex-col items-center gap-3 text-center">
      <p aria-live="polite" className="text-xs text-faint">
        {t("projects.pagination.showing", { shown, total })}
      </p>
      {hasError && (
        <p role="alert" className="text-sm text-destructive">
          {t("projects.pagination.loadMoreError")}
        </p>
      )}
      {hasMore && (
        <Button
          variant="outline"
          onClick={onLoadMore}
          aria-disabled={isLoadingMore}
          className="min-w-40"
        >
          {isLoadingMore && (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
          )}
          {t(
            isLoadingMore
              ? "common.loading"
              : hasError
                ? "common.retry"
                : "projects.pagination.loadMore",
          )}
        </Button>
      )}
    </div>
  );
}
