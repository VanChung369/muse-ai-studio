import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { formatDuration } from "@/lib/format";

// "running for 1:24", counted from the task's real start time. Muse reports
// no percentage, so elapsed time is the only honest sign of progress.
export function RenderElapsed({ since }: { since: string }) {
  const { t } = useTranslation();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const seconds = Math.max(0, Math.floor((now - Date.parse(since)) / 1000));
  return (
    <span className="tabular-nums">
      {t("projects.render.elapsed", { time: formatDuration(seconds) })}
    </span>
  );
}
