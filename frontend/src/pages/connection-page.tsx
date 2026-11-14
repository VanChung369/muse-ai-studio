import {
  BookOpen,
  Check,
  KeyRound,
  RefreshCw,
  SquareTerminal,
} from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ROUTES } from "@/constants/routes";
import { ApiKeyRow } from "@/features/api-access/components/api-key-row";
import { CodeBlock } from "@/features/api-access/components/code-block";
import { CopyButton } from "@/features/api-access/components/copy-button";
import { CreateApiKeyDialog } from "@/features/api-access/components/create-api-key-dialog";
import {
  API_KEY_COLUMNS,
  MAX_API_KEYS,
  QUICKSTART_LANGUAGES,
  V1_BASE_PATH,
} from "@/features/api-access/constants";
import { useApiKeysQuery } from "@/features/api-access/hooks/use-api-keys";
import { useCopyClipboard } from "@/features/api-access/hooks/use-copy-clipboard";
import { buildQuickstartSnippet } from "@/features/api-access/lib/snippets";
import type { QuickstartLanguage } from "@/features/api-access/types";
import { usePublicOrigin } from "@/features/settings/hooks/use-settings";
import { useDocumentTitle } from "@/hooks/use-document-title";

const ENV_VAR_LINE = "MUSE_API_KEY=<your key>";

export function ConnectionPage() {
  const { t } = useTranslation();
  const id = useId();
  useDocumentTitle(t("pages.api.title"));

  const keysQuery = useApiKeysQuery();
  const baseUrl = `${usePublicOrigin()}${V1_BASE_PATH}`;

  const baseUrlCopy = useCopyClipboard();
  const envCopy = useCopyClipboard();
  const baseUrlInputRef = useRef<HTMLInputElement>(null);
  const envInputRef = useRef<HTMLInputElement>(null);

  const [quickstartLang, setQuickstartLang] =
    useState<QuickstartLanguage>("curl");
  const [notice, setNotice] = useState<{
    kind: "created" | "revoked";
    name: string;
  } | null>(null);

  const keys = keysQuery.data;
  const atLimit = keys !== undefined && keys.length >= MAX_API_KEYS;

  async function copyReadOnlyField(
    value: string,
    clipboard: ReturnType<typeof useCopyClipboard>,
    inputRef: React.RefObject<HTMLInputElement | null>,
  ) {
    const ok = await clipboard.copy(value);
    if (!ok) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.api.title")}
        description={t("pages.api.description")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ROUTES.DOCS}>
                <BookOpen aria-hidden="true" />
                {t("apiAccess.links.docs")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={ROUTES.PLAYGROUND}>
                <SquareTerminal aria-hidden="true" />
                {t("apiAccess.links.playground")}
              </Link>
            </Button>
          </>
        }
      />

      {notice && (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 wrap-anywhere">
            {t(
              notice.kind === "created"
                ? "apiAccess.keys.createdNotice"
                : "apiAccess.keys.revokedNotice",
              { name: notice.name },
            )}
          </span>
        </p>
      )}

      <div className="space-y-6">
        <section
          aria-labelledby={`${id}-conn-heading`}
          className="rounded-xl border bg-card p-5"
        >
          <h2 id={`${id}-conn-heading`} className="text-base font-semibold">
            {t("apiAccess.connection.title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("apiAccess.connection.description")}
          </p>

          <div className="mt-5 grid gap-5 desktop:grid-cols-2">
            <div className="min-w-0 space-y-2">
              <Label htmlFor={`${id}-base-url`}>
                {t("apiAccess.connection.baseUrl")}
              </Label>
              <div className="flex gap-2">
                <Input
                  ref={baseUrlInputRef}
                  id={`${id}-base-url`}
                  type="text"
                  readOnly
                  value={baseUrl}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-9 flex-1 font-mono text-xs max-tablet:h-11"
                />
                <CopyButton
                  copied={baseUrlCopy.copied}
                  onCopy={() =>
                    void copyReadOnlyField(
                      baseUrl,
                      baseUrlCopy,
                      baseUrlInputRef,
                    )
                  }
                  size="default"
                />
              </div>
              {baseUrlCopy.failedText !== null && (
                <p role="alert" className="text-xs leading-5 text-warning">
                  {t("apiAccess.clipboard.failed")}
                </p>
              )}
              <p className="text-xs leading-5 text-faint">
                {t("apiAccess.connection.baseUrlHint")}
              </p>
            </div>

            <div className="min-w-0 space-y-2">
              <Label htmlFor={`${id}-env-var`}>
                {t("apiAccess.connection.envVar")}
              </Label>
              <div className="flex gap-2">
                <Input
                  ref={envInputRef}
                  id={`${id}-env-var`}
                  type="text"
                  readOnly
                  value={ENV_VAR_LINE}
                  onFocus={(event) => event.currentTarget.select()}
                  className="h-9 flex-1 font-mono text-xs max-tablet:h-11"
                />
                <CopyButton
                  copied={envCopy.copied}
                  onCopy={() =>
                    void copyReadOnlyField(ENV_VAR_LINE, envCopy, envInputRef)
                  }
                  size="default"
                />
              </div>
              {envCopy.failedText !== null && (
                <p role="alert" className="text-xs leading-5 text-warning">
                  {t("apiAccess.clipboard.failed")}
                </p>
              )}
              <p className="text-xs leading-5 text-faint">
                {t("apiAccess.connection.envVarHint")}
              </p>
            </div>
          </div>
        </section>

        <section aria-labelledby={`${id}-keys-heading`} className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 id={`${id}-keys-heading`} className="text-base font-semibold">
                {t("apiAccess.keys.title")}
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {keys
                  ? t("apiAccess.keys.countDescription", {
                      count: keys.length,
                      max: MAX_API_KEYS,
                    })
                  : t("apiAccess.keys.description")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={keysQuery.isFetching}
                aria-label={t("apiAccess.keys.refresh")}
                onClick={() => void keysQuery.refetch()}
              >
                <RefreshCw
                  className={
                    keysQuery.isFetching
                      ? "animate-spin motion-reduce:animate-none"
                      : undefined
                  }
                  aria-hidden="true"
                />
              </Button>
              <CreateApiKeyDialog
                disabled={atLimit || keysQuery.isPending}
                onCreated={(name) => setNotice({ kind: "created", name })}
              />
            </div>
          </div>

          {atLimit && (
            <p
              role="status"
              className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs leading-5 text-warning"
            >
              {t("apiAccess.keys.limitReached", { max: MAX_API_KEYS })}
            </p>
          )}

          {keysQuery.isPending && <PageLoading />}

          {keysQuery.isError && (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-destructive/30 bg-card p-5"
            >
              <p className="text-sm text-destructive">
                {t("apiAccess.errors.load")}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={keysQuery.isFetching}
                onClick={() => void keysQuery.refetch()}
              >
                {t("common.retry")}
              </Button>
            </div>
          )}

          {keys &&
            (keys.length > 0 ? (
              <div className="rounded-xl border bg-card tablet:overflow-x-auto">
                <table className="w-full table-fixed border-collapse text-left text-sm max-tablet:block tablet:min-w-170">
                  <colgroup className="max-tablet:hidden">
                    <col className="w-[24%]" />
                    <col className="w-[24%]" />
                    <col className="w-[15%]" />
                    <col className="w-[15%]" />
                    <col className="w-[22%]" />
                  </colgroup>
                  <thead className="border-b bg-secondary text-xs text-faint max-tablet:hidden">
                    <tr>
                      {API_KEY_COLUMNS.map((column) => (
                        <th
                          key={column}
                          scope="col"
                          className="px-4 py-3 font-medium whitespace-nowrap last:text-right"
                        >
                          {column === "actions" ? (
                            <span className="sr-only">
                              {t("apiAccess.fields.actions")}
                            </span>
                          ) : (
                            t(`apiAccess.fields.${column}`)
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="max-tablet:block">
                    {keys.map((apiKey) => (
                      <ApiKeyRow
                        key={apiKey.id}
                        apiKey={apiKey}
                        onRevoked={(name) =>
                          setNotice({ kind: "revoked", name })
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
                <span className="grid size-11 place-items-center rounded-xl bg-primary-soft text-primary">
                  <KeyRound className="size-5" aria-hidden="true" />
                </span>
                <h3 className="text-base font-semibold">
                  {t("apiAccess.empty.title")}
                </h3>
                <p className="max-w-md text-sm leading-6 text-muted-foreground">
                  {t("apiAccess.empty.description")}
                </p>
              </div>
            ))}
        </section>

        <section
          aria-labelledby={`${id}-quickstart-heading`}
          className="rounded-xl border bg-card p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2
                id={`${id}-quickstart-heading`}
                className="text-base font-semibold"
              >
                {t("apiAccess.quickstart.title")}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("apiAccess.quickstart.description")}
              </p>
            </div>
            <div
              role="tablist"
              aria-label={t("apiAccess.quickstart.languagesLabel")}
              className="flex flex-wrap gap-1.5"
            >
              {QUICKSTART_LANGUAGES.map((lang) => (
                <Button
                  key={lang}
                  id={`${id}-tab-${lang}`}
                  type="button"
                  role="tab"
                  size="sm"
                  aria-selected={quickstartLang === lang}
                  aria-controls={`${id}-panel-${lang}`}
                  variant={quickstartLang === lang ? "default" : "outline"}
                  onClick={() => setQuickstartLang(lang)}
                >
                  {t(`apiAccess.quickstart.tabs.${lang}`)}
                </Button>
              ))}
            </div>
          </div>

          <div
            id={`${id}-panel-${quickstartLang}`}
            role="tabpanel"
            aria-labelledby={`${id}-tab-${quickstartLang}`}
            className="mt-4"
          >
            <CodeBlock
              code={buildQuickstartSnippet(quickstartLang, baseUrl)}
              label={t(`apiAccess.quickstart.tabs.${quickstartLang}`)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
