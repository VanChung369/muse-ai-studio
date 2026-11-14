import { KeyRound, SquareTerminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/constants/routes";
import { CodeBlock } from "@/features/api-access/components/code-block";
import {
  DOCS_ERROR_ROWS,
  DOCS_SECTIONS,
  V1_BASE_PATH,
} from "@/features/api-access/constants";
import { usePublicOrigin } from "@/features/settings/hooks/use-settings";
import { useDocumentTitle } from "@/hooks/use-document-title";

export function DocsPage() {
  const { t } = useTranslation();
  useDocumentTitle(t("pages.docs.title"));

  const origin = usePublicOrigin();
  const baseUrl = `${origin}${V1_BASE_PATH}`;

  const modelsExampleResponse = `{
  "object": "list",
  "data": [
    {"id": "muse-image", "object": "model", "created": 1763078400, "owned_by": "muse"},
    {"id": "muse-video", "object": "model", "created": 1763078400, "owned_by": "muse"}
  ]
}`;

  const imagesExampleRequest = `{
  "model": "muse-image",
  "prompt": "A glass of iced coffee on a window sill",
  "n": 1,
  "size": "1024x1024",
  "response_format": "url"
}`;

  const imagesExampleResponse = `{
  "created": 1763078400,
  "data": [
    {"url": "${origin}/api/library/assets/<id>/file"}
  ]
}`;

  const videosExampleRequest = `{
  "model": "muse-video",
  "prompt": "Slow pan across a rain-washed street at dusk",
  "aspect_ratio": "16:9"
}`;

  const videosCreateResponse = `{
  "id": "<generation id>",
  "object": "video.generation",
  "status": "queued",
  "created": 1763078400,
  "model": "muse-video"
}`;

  const videosPollResponse = `{
  "id": "<generation id>",
  "object": "video.generation",
  "status": "succeeded",
  "created": 1763078400,
  "model": "muse-video",
  "data": [
    {"url": "${origin}/api/library/assets/<id>/file"}
  ]
}`;

  const chatExampleRequest = `{
  "model": "muse-image",
  "messages": [
    {"role": "user", "content": "A red fox in snow"}
  ],
  "stream": false
}`;

  const chatExampleResponse = `{
  "id": "chatcmpl-<task id>",
  "object": "chat.completion",
  "created": 1763078400,
  "model": "muse-image",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "![image](${origin}/api/library/assets/<id>/file)"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
}`;

  const chatStreamExample = `data: {"id":"chatcmpl-<task id>","object":"chat.completion.chunk","created":1763078400,"model":"muse-image","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}

: waiting

data: {"id":"chatcmpl-<task id>","object":"chat.completion.chunk","created":1763078400,"model":"muse-image","choices":[{"index":0,"delta":{"content":"![image](${origin}/api/library/assets/<id>/file)"},"finish_reason":null}]}

data: {"id":"chatcmpl-<task id>","object":"chat.completion.chunk","created":1763078400,"model":"muse-image","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: [DONE]`;

  const errorShapeExample = `{
  "error": {
    "message": "Human-readable text.",
    "type": "invalid_request_error",
    "code": "invalid_api_key"
  }
}`;

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      <PageHeader
        title={t("pages.docs.title")}
        description={t("pages.docs.description")}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ROUTES.API}>
                <KeyRound aria-hidden="true" />
                {t("apiDocs.links.connection")}
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={ROUTES.PLAYGROUND}>
                <SquareTerminal aria-hidden="true" />
                {t("apiDocs.links.playground")}
              </Link>
            </Button>
          </>
        }
      />

      <nav
        aria-label={t("apiDocs.onThisPage")}
        className="mb-6 rounded-xl border bg-card p-4 desktop:hidden"
      >
        <p className="text-xs font-semibold tracking-wide text-faint uppercase">
          {t("apiDocs.onThisPage")}
        </p>
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
          {DOCS_SECTIONS.map((section) => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                className="text-muted-foreground hover:text-primary"
              >
                {t(`apiDocs.sections.${section.key}`)}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid items-start gap-8 desktop:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="min-w-0 space-y-8">
          <section
            id="base-url"
            className="scroll-mt-6 space-y-3 rounded-xl border bg-card p-5"
          >
            <h2 className="text-base font-semibold">
              {t("apiDocs.sections.baseUrl")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("apiDocs.baseUrl.description")}
            </p>
            <CodeBlock code={baseUrl} label="Base URL" />
          </section>

          <section
            id="authentication"
            className="scroll-mt-6 space-y-3 rounded-xl border bg-card p-5"
          >
            <h2 className="text-base font-semibold">
              {t("apiDocs.sections.auth")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("apiDocs.auth.description")}
            </p>
            <CodeBlock
              code="Authorization: Bearer sk-muse-<48 lowercase hex chars>"
              label="HTTP Header"
            />
            <p className="text-xs leading-5 text-faint">
              {t("apiDocs.auth.hint")}
            </p>
          </section>

          <section
            id="waiting"
            className="scroll-mt-6 space-y-4 rounded-xl border bg-card p-5"
          >
            <h2 className="text-base font-semibold">
              {t("apiDocs.sections.waiting")}
            </h2>
            <ul className="space-y-2.5 text-sm leading-6 text-muted-foreground">
              <li>{t("apiDocs.waiting.sync")}</li>
              <li>{t("apiDocs.waiting.async")}</li>
            </ul>
            <div className="rounded-lg border border-warning/30 bg-warning-soft p-3.5 text-xs leading-5 text-warning">
              <p className="font-semibold">{t("apiDocs.waiting.timeoutTitle")}</p>
              <p className="mt-1">{t("apiDocs.waiting.timeoutBody")}</p>
            </div>
          </section>

          <section
            id="models"
            className="scroll-mt-6 space-y-3 rounded-xl border bg-card p-5"
          >
            <h2 className="text-base font-semibold">
              {t("apiDocs.sections.models")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("apiDocs.models.description")}
            </p>
            <div className="scroll-subtle overflow-x-auto rounded-lg border">
              <table className="w-full min-w-120 text-left text-sm">
                <thead className="border-b bg-secondary text-xs text-faint">
                  <tr>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      {t("apiDocs.tables.model")}
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      {t("apiDocs.tables.output")}
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      {t("apiDocs.tables.usedIn")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y text-[13px]">
                  <tr>
                    <td className="px-3.5 py-2.5 font-mono font-medium">
                      muse-image
                    </td>
                    <td className="px-3.5 py-2.5 text-muted-foreground">
                      {t("apiDocs.models.imageDesc")}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                      /v1/images/generations, /v1/chat/completions
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3.5 py-2.5 font-mono font-medium">
                      muse-video
                    </td>
                    <td className="px-3.5 py-2.5 text-muted-foreground">
                      {t("apiDocs.models.videoDesc")}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                      /v1/videos/generations, /v1/chat/completions
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="endpoints" className="scroll-mt-6 space-y-6">
            <h2 className="text-lg font-semibold">
              {t("apiDocs.sections.endpoints")}
            </h2>

            <EndpointCard
              method="GET"
              path="/v1/models"
              description={t("apiDocs.endpoints.models.description")}
              responseExample={modelsExampleResponse}
              responseLabel="200 OK"
            />

            <EndpointCard
              method="POST"
              path="/v1/images/generations"
              description={t("apiDocs.endpoints.images.description")}
              extraNote={t("apiDocs.endpoints.images.note")}
              params={[
                {
                  name: "prompt",
                  type: "string",
                  required: true,
                  description: t("apiDocs.endpoints.images.params.prompt"),
                },
                {
                  name: "model",
                  type: "string",
                  required: false,
                  description: t("apiDocs.endpoints.images.params.model"),
                },
                {
                  name: "n",
                  type: "integer",
                  required: false,
                  description: t("apiDocs.endpoints.images.params.n"),
                },
                {
                  name: "size",
                  type: "string",
                  required: false,
                  description: t("apiDocs.endpoints.images.params.size"),
                },
                {
                  name: "aspect_ratio",
                  type: "string",
                  required: false,
                  description: t("apiDocs.endpoints.images.params.aspectRatio"),
                },
                {
                  name: "response_format",
                  type: "string",
                  required: false,
                  description: t(
                    "apiDocs.endpoints.images.params.responseFormat",
                  ),
                },
              ]}
              requestExample={imagesExampleRequest}
              responseExample={imagesExampleResponse}
              responseLabel="200 OK · X-Muse-Task-Id"
            />

            <EndpointCard
              method="POST"
              path="/v1/videos/generations"
              description={t("apiDocs.endpoints.videosCreate.description")}
              params={[
                {
                  name: "model",
                  type: "string",
                  required: true,
                  description: t("apiDocs.endpoints.videosCreate.params.model"),
                },
                {
                  name: "prompt",
                  type: "string",
                  required: true,
                  description: t(
                    "apiDocs.endpoints.videosCreate.params.prompt",
                  ),
                },
                {
                  name: "aspect_ratio",
                  type: "string",
                  required: false,
                  description: t(
                    "apiDocs.endpoints.videosCreate.params.aspectRatio",
                  ),
                },
              ]}
              requestExample={videosExampleRequest}
              responseExample={videosCreateResponse}
              responseLabel="202 Accepted"
            />

            <EndpointCard
              method="GET"
              path="/v1/videos/generations/{id}"
              description={t("apiDocs.endpoints.videosPoll.description")}
              extraNote={t("apiDocs.endpoints.videosPoll.note")}
              params={[
                {
                  name: "id",
                  type: "string (path)",
                  required: true,
                  description: t("apiDocs.endpoints.videosPoll.params.id"),
                },
              ]}
              responseExample={videosPollResponse}
              responseLabel="200 OK"
            />

            <EndpointCard
              method="POST"
              path="/v1/chat/completions"
              description={t("apiDocs.endpoints.chat.description")}
              extraNote={t("apiDocs.endpoints.chat.note")}
              params={[
                {
                  name: "model",
                  type: "string",
                  required: true,
                  description: t("apiDocs.endpoints.chat.params.model"),
                },
                {
                  name: "messages",
                  type: "array",
                  required: true,
                  description: t("apiDocs.endpoints.chat.params.messages"),
                },
                {
                  name: "stream",
                  type: "boolean",
                  required: false,
                  description: t("apiDocs.endpoints.chat.params.stream"),
                },
              ]}
              requestExample={chatExampleRequest}
              responseExample={chatExampleResponse}
              responseLabel="200 OK (stream: false)"
              secondaryCode={{
                title: t("apiDocs.endpoints.chat.streamTitle"),
                label: "text/event-stream (stream: true)",
                code: chatStreamExample,
              }}
            />
          </section>

          <section
            id="errors"
            className="scroll-mt-6 space-y-4 rounded-xl border bg-card p-5"
          >
            <h2 className="text-base font-semibold">
              {t("apiDocs.sections.errors")}
            </h2>
            <p className="text-sm leading-6 text-muted-foreground">
              {t("apiDocs.errors.description")}
            </p>
            <CodeBlock code={errorShapeExample} label="application/json" />
            <div className="scroll-subtle overflow-x-auto rounded-lg border">
              <table className="w-full min-w-170 text-left text-sm">
                <thead className="border-b bg-secondary text-xs text-faint">
                  <tr>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      HTTP
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      type
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      code
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      {t("apiDocs.tables.when")}
                    </th>
                    <th scope="col" className="px-3.5 py-2.5 font-medium">
                      {t("apiDocs.tables.whatToDo")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y text-[13px]">
                  {DOCS_ERROR_ROWS.map((row) => (
                    <tr key={`${row.http}-${row.code}`}>
                      <td className="px-3.5 py-2.5 font-mono font-semibold">
                        {row.http}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-xs text-muted-foreground">
                        {row.type}
                      </td>
                      <td className="px-3.5 py-2.5 font-mono text-xs text-destructive">
                        {row.code}
                      </td>
                      <td className="px-3.5 py-2.5 text-muted-foreground">
                        {t(`apiDocs.errors.rows.${row.code}.when`)}
                      </td>
                      <td className="px-3.5 py-2.5 text-foreground">
                        {t(`apiDocs.errors.rows.${row.code}.action`)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section
            id="notes"
            className="scroll-mt-6 space-y-3 rounded-xl border bg-card p-5"
          >
            <h2 className="text-base font-semibold">
              {t("apiDocs.sections.notes")}
            </h2>
            <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-muted-foreground">
              <li>{t("apiDocs.notes.library")}</li>
              <li>{t("apiDocs.notes.tasksAndHistory")}</li>
              <li>{t("apiDocs.notes.noKeyDownloads")}</li>
              <li>{t("apiDocs.notes.revocationAndUsage")}</li>
            </ul>
          </section>
        </div>

        <aside
          aria-label={t("apiDocs.onThisPage")}
          className="hidden rounded-xl border bg-card p-4 desktop:sticky desktop:top-6 desktop:block"
        >
          <p className="text-xs font-semibold tracking-wide text-faint uppercase">
            {t("apiDocs.onThisPage")}
          </p>
          <nav className="mt-3">
            <ul className="space-y-1.5 text-[13px]">
              {DOCS_SECTIONS.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="block rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    {t(`apiDocs.sections.${section.key}`)}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      </div>
    </div>
  );
}

type EndpointParam = {
  name: string;
  type: string;
  required: boolean;
  description: string;
};

function EndpointCard({
  method,
  path,
  description,
  extraNote,
  params,
  requestExample,
  responseExample,
  responseLabel,
  secondaryCode,
}: {
  method: "GET" | "POST";
  path: string;
  description: string;
  extraNote?: string;
  params?: EndpointParam[];
  requestExample?: string;
  responseExample: string;
  responseLabel: string;
  secondaryCode?: { title: string; label: string; code: string };
}) {
  const { t } = useTranslation();

  return (
    <article className="space-y-4 rounded-xl border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <span
          className={
            method === "GET"
              ? "rounded-md bg-running-soft px-2 py-0.5 font-mono text-xs font-semibold text-running"
              : "rounded-md bg-primary-soft px-2 py-0.5 font-mono text-xs font-semibold text-primary"
          }
        >
          {method}
        </span>
        <h3 className="font-mono text-sm font-semibold wrap-anywhere">
          {path}
        </h3>
      </div>

      <p className="text-sm leading-6 text-muted-foreground">{description}</p>

      {extraNote && (
        <p className="rounded-lg border bg-background/60 px-3.5 py-2.5 text-xs leading-5 text-muted-foreground">
          {extraNote}
        </p>
      )}

      {params && params.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold tracking-wide text-faint uppercase">
            {t("apiDocs.tables.parameters")}
          </h4>
          <div className="scroll-subtle overflow-x-auto rounded-lg border">
            <table className="w-full min-w-130 text-left text-sm">
              <thead className="border-b bg-secondary text-xs text-faint">
                <tr>
                  <th scope="col" className="px-3.5 py-2 font-medium">
                    {t("apiDocs.tables.name")}
                  </th>
                  <th scope="col" className="px-3.5 py-2 font-medium">
                    {t("apiDocs.tables.type")}
                  </th>
                  <th scope="col" className="px-3.5 py-2 font-medium">
                    {t("apiDocs.tables.description")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y text-[13px]">
                {params.map((param) => (
                  <tr key={param.name} className="align-top">
                    <td className="px-3.5 py-2.5 font-mono font-medium whitespace-nowrap">
                      {param.name}
                      {param.required && (
                        <span className="ml-1.5 text-[11px] font-normal text-warning">
                          {t("apiDocs.tables.required")}
                        </span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5 font-mono text-xs whitespace-nowrap text-faint">
                      {param.type}
                    </td>
                    <td className="px-3.5 py-2.5 text-muted-foreground">
                      {param.description}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid gap-4 desktop:grid-cols-2">
        {requestExample && (
          <div className="min-w-0 space-y-2">
            <h4 className="text-xs font-semibold tracking-wide text-faint uppercase">
              {t("apiDocs.exampleRequest")}
            </h4>
            <CodeBlock code={requestExample} label="application/json" />
          </div>
        )}
        <div
          className={
            requestExample ? "min-w-0 space-y-2" : "min-w-0 space-y-2 desktop:col-span-2"
          }
        >
          <h4 className="text-xs font-semibold tracking-wide text-faint uppercase">
            {t("apiDocs.exampleResponse")}
          </h4>
          <CodeBlock code={responseExample} label={responseLabel} />
        </div>
      </div>

      {secondaryCode && (
        <div className="min-w-0 space-y-2">
          <h4 className="text-xs font-semibold tracking-wide text-faint uppercase">
            {secondaryCode.title}
          </h4>
          <CodeBlock code={secondaryCode.code} label={secondaryCode.label} />
        </div>
      )}
    </article>
  );
}
