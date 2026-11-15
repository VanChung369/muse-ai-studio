import { ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CONTENT_BLOCKED_EVENT, type ContentBlocked } from "@/lib/http";

const CATEGORIES = [
  "gambling",
  "drugs",
  "weapons",
  "child_abuse",
  "sexual",
  "terrorism",
  "fraud",
  "hacking",
  "trafficking",
  "self_harm",
  "custom",
] as const;

/** Says why the server refused a request for its content, wherever in the
 * app it was sent (see announceContentBlocked in lib/http.ts). */
export function ContentBlockedNotice() {
  const { t } = useTranslation();
  const [blocked, setBlocked] = useState<ContentBlocked | null>(null);

  useEffect(() => {
    function show(event: Event) {
      setBlocked((event as CustomEvent<ContentBlocked>).detail);
    }
    window.addEventListener(CONTENT_BLOCKED_EVENT, show);
    return () => window.removeEventListener(CONTENT_BLOCKED_EVENT, show);
  }, []);

  const category = CATEGORIES.find((name) => name === blocked?.category) ?? "custom";

  return (
    <Dialog open={blocked !== null} onOpenChange={(open) => !open && setBlocked(null)}>
      <DialogContent className="p-6 sm:max-w-md">
        <DialogHeader className="pr-6">
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert aria-hidden="true" className="size-5 text-destructive" />
            {t("contentPolicy.title")}
          </DialogTitle>
          <DialogDescription className="leading-6 wrap-break-word">
            {t("contentPolicy.description", {
              term: blocked?.term ?? "",
              category: t(`contentPolicy.categories.${category}`),
            })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm leading-6 text-muted-foreground">{t("contentPolicy.hint")}</p>
        <DialogFooter className="-mx-6 -mb-6 px-6 py-4">
          <Button type="button" onClick={() => setBlocked(null)}>
            {t("contentPolicy.ok")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
