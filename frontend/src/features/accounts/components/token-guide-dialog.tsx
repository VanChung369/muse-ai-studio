import { CircleHelp, ExternalLink, ShieldAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const MUSE_URL = "https://muse.ai";
// The steps of each way, in order; their text lives in the translations.
const NETWORK_STEPS = ["open", "devtools", "request", "copy", "paste"] as const;
const COOKIE_STEPS = ["application", "value", "paste"] as const;

/**
 * How to get the session ("token") this app signs in to Muse with: the
 * `hatch_sess` cookie of a browser where the user is logged in.
 */
export function TokenGuideDialog() {
  const { t } = useTranslation();

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          <CircleHelp aria-hidden="true" />
          {t("accounts.guide.action")}
        </Button>
      </DialogTrigger>
      <DialogContent className="scroll-subtle max-h-[90svh] overflow-y-auto tablet:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("accounts.guide.title")}</DialogTitle>
          <DialogDescription>
            {t("accounts.guide.description")}
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold">
            {t("accounts.guide.network.title")}
          </h3>
          <ol className="space-y-2">
            {NETWORK_STEPS.map((step, index) => (
              <Step key={step} number={index + 1}>
                {t(`accounts.guide.network.${step}`)}
                {step === "open" && (
                  <>
                    {" "}
                    <a
                      href={MUSE_URL}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                    >
                      muse.ai
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </>
                )}
              </Step>
            ))}
          </ol>
        </section>

        <section className="space-y-2.5">
          <h3 className="text-sm font-semibold">
            {t("accounts.guide.cookie.title")}
          </h3>
          <ol className="space-y-2">
            {COOKIE_STEPS.map((step, index) => (
              <Step key={step} number={index + 1}>
                {t(`accounts.guide.cookie.${step}`)}
                {step === "paste" && (
                  <code className="mt-1.5 block rounded-md border bg-secondary px-2.5 py-1.5 font-mono text-xs wrap-anywhere select-all">
                    hatch_sess=…
                  </code>
                )}
              </Step>
            ))}
          </ol>
        </section>

        <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning-soft p-3 text-xs leading-5 text-warning">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <ul className="list-disc space-y-1 pl-4">
            <li>{t("accounts.guide.notes.secret")}</li>
            <li>{t("accounts.guide.notes.expiry")}</li>
            <li>{t("accounts.guide.notes.stored")}</li>
          </ul>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button>{t("accounts.guide.close")}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Step({
  number,
  children,
}: {
  number: number;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2.5 text-sm leading-6">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent font-mono text-[11px] text-muted-foreground"
      >
        {number}
      </span>
      <span className="min-w-0 flex-1 text-muted-foreground">{children}</span>
    </li>
  );
}
