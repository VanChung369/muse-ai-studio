import { zodResolver } from "@hookform/resolvers/zod";
import { Check, CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useId, type ReactNode } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";

import { PageHeader } from "@/components/shared/page-header";
import { PageLoading } from "@/components/shared/page-loading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PROJECT_ASPECT_RATIOS,
  PROJECT_CONTINUITIES,
  PROJECT_LANGUAGES,
  PROJECT_LONG_SECONDS,
  PROJECT_LOOKS,
  PROJECT_MAX_SECONDS,
} from "@/features/projects/constants";
import {
  type AppSettings,
  projectDefaultsSchema,
  type SystemStatus,
} from "@/features/settings/api/settings";
import {
  useSettingsQuery,
  useSystemQuery,
  useUpdateSettings,
} from "@/features/settings/hooks/use-settings";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { ApiError } from "@/lib/http";
import { cn } from "@/lib/utils";

const SELECT_TRIGGER =
  "w-full data-[size=default]:h-9 data-[size=default]:max-tablet:h-11";

// The form: the stored settings, with the address as text ("" = not set).
const formSchema = z.object({
  projectDefaults: projectDefaultsSchema,
  publicUrl: z
    .string()
    .trim()
    .max(200)
    // What the server accepts: http(s), a host, maybe a port and a path.
    .regex(/^(https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?)?$/),
});
type FormValues = z.infer<typeof formSchema>;

const toForm = (settings: AppSettings): FormValues => ({
  projectDefaults: settings.projectDefaults,
  publicUrl: settings.publicUrl ?? "",
});

// The server's start-up limits, each with the variable that sets it.
const LIMITS = [
  ["taskWorkers", "MUSE_TASK_WORKERS"],
  ["browserSlots", "MUSE_BROWSER_SLOTS"],
  ["planningTimeout", "MUSE_PLANNING_TIMEOUT"],
  ["renderTimeout", "MUSE_RENDER_TIMEOUT"],
  ["threadSceneLimit", "MUSE_THREAD_SCENE_LIMIT"],
  ["sessionRefreshMinutes", "MUSE_SESSION_REFRESH_MINUTES"],
  ["sessionRefreshWake", "MUSE_SESSION_REFRESH_WAKE"],
] as const;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(Math.round(bytes / 1024), 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const title = t("pages.settings.title");
  useDocumentTitle(title);
  const settings = useSettingsQuery();
  const update = useUpdateSettings();

  return (
    <div className="w-full max-w-340 px-4 pt-5 pb-10 tablet:px-8 tablet:pt-7 tablet:pb-14">
      {settings.isPending ? (
        <>
          <PageHeader
            title={title}
            description={t("pages.settings.description")}
          />
          <PageLoading />
        </>
      ) : settings.isError ? (
        <>
          <PageHeader
            title={title}
            description={t("pages.settings.description")}
          />
          <div
            role="alert"
            className="space-y-3 rounded-xl border px-6 py-10 text-center"
          >
            <p className="text-sm text-destructive">
              {t("appSettings.loadError")}
            </p>
            <Button
              variant="outline"
              disabled={settings.isFetching}
              onClick={() => void settings.refetch()}
            >
              {t("appSettings.retry")}
            </Button>
          </div>
        </>
      ) : (
        // A fresh form whenever the stored settings change (after a save).
        <SettingsForm
          key={JSON.stringify(settings.data)}
          settings={settings.data}
          title={title}
          update={update}
        />
      )}
      <SystemSection />
    </div>
  );
}

function SettingsForm({
  settings,
  title,
  update,
}: {
  settings: AppSettings;
  title: string;
  // Kept by the page: the form is built afresh after a save, and what the
  // save reported must outlive it.
  update: ReturnType<typeof useUpdateSettings>;
}) {
  const { t } = useTranslation();
  const id = useId();
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(settings),
  });
  const [durationSeconds, publicUrl] = useWatch({
    control,
    name: ["projectDefaults.durationSeconds", "publicUrl"],
  });
  const pending = update.isPending;
  const address = (publicUrl ?? "").trim().replace(/\/+$/, "");

  function submit(values: FormValues) {
    update.mutate({
      projectDefaults: values.projectDefaults,
      publicUrl: values.publicUrl.replace(/\/+$/, "") || null,
    });
  }

  return (
    <form onSubmit={(event) => void handleSubmit(submit)(event)} noValidate>
      <PageHeader
        title={title}
        description={t("pages.settings.description")}
        actions={
          <>
            {isDirty && !pending && (
              <span className="text-xs text-warning">
                {t("appSettings.unsaved")}
              </span>
            )}
            {isDirty && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  reset(toForm(settings));
                  update.reset();
                }}
              >
                {t("appSettings.discard")}
              </Button>
            )}
            <Button type="submit" disabled={!isDirty || pending}>
              {pending && (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {t(pending ? "appSettings.saving" : "appSettings.save")}
            </Button>
          </>
        }
      />
      {update.isSuccess && !isDirty && (
        <p
          role="status"
          className="mb-5 flex items-center gap-2 rounded-lg border border-success/30 bg-success-soft px-4 py-3 text-sm text-success"
        >
          <Check className="size-4 shrink-0" aria-hidden="true" />
          {t("appSettings.saved")}
        </p>
      )}
      {update.isError && (
        <p
          role="alert"
          className="mb-5 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive-soft px-4 py-3 text-sm text-destructive"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden="true" />
          {t(
            update.error instanceof ApiError && update.error.status === 422
              ? "appSettings.errors.invalid"
              : "appSettings.errors.save",
          )}
        </p>
      )}

      <div className="space-y-5">
        <Card
          title={t("appSettings.defaults.title")}
          description={t("appSettings.defaults.description")}
        >
          <fieldset
            disabled={pending}
            className="grid min-w-0 gap-5 tablet:grid-cols-2 desktop:grid-cols-3"
          >
            <div className="space-y-2">
              <Label htmlFor={`${id}-duration`}>
                {t("projects.form.duration")}
              </Label>
              <Input
                {...register("projectDefaults.durationSeconds", {
                  valueAsNumber: true,
                })}
                id={`${id}-duration`}
                type="number"
                min={10}
                max={PROJECT_MAX_SECONDS}
                step={5}
                aria-invalid={Boolean(errors.projectDefaults?.durationSeconds)}
                aria-describedby={`${id}-duration-hint`}
                className="h-9 max-tablet:h-11"
              />
              <p
                id={`${id}-duration-hint`}
                role={
                  errors.projectDefaults?.durationSeconds ? "alert" : undefined
                }
                className={cn(
                  "text-xs",
                  errors.projectDefaults?.durationSeconds
                    ? "text-destructive"
                    : "text-faint",
                )}
              >
                {t(
                  errors.projectDefaults?.durationSeconds
                    ? "projects.form.errors.durationSeconds"
                    : "projects.form.durationHint",
                )}
              </p>
              {Number.isFinite(durationSeconds) &&
                durationSeconds > PROJECT_LONG_SECONDS &&
                durationSeconds <= PROJECT_MAX_SECONDS && (
                  <p
                    role="status"
                    className="rounded-lg border border-warning/40 bg-warning-soft p-2.5 text-xs leading-5 text-warning"
                  >
                    {t("projects.form.durationLong", {
                      scenes: Math.ceil(durationSeconds / 10),
                    })}
                  </p>
                )}
            </div>
            <Choice
              id={`${id}-ratio`}
              label={t("projects.form.ratio")}
              name="projectDefaults.aspectRatio"
              control={control}
              options={PROJECT_ASPECT_RATIOS.map((ratio) => [ratio, ratio])}
            />
            <Choice
              id={`${id}-language`}
              label={t("projects.settings.language")}
              name="projectDefaults.language"
              control={control}
              options={PROJECT_LANGUAGES.map((language) => [
                language,
                t(`projects.settings.languages.${language}`),
              ])}
            />
            <Choice
              id={`${id}-look`}
              label={t("projects.settings.look")}
              name="projectDefaults.look"
              control={control}
              options={PROJECT_LOOKS.map((look) => [
                look,
                t(`projects.settings.looks.${look}`),
              ])}
            />
            <Choice
              id={`${id}-continuity`}
              label={t("projects.settings.continuity")}
              name="projectDefaults.continuity"
              control={control}
              options={PROJECT_CONTINUITIES.map((continuity) => [
                continuity,
                t(`projects.settings.continuities.${continuity}`),
              ])}
            />
          </fieldset>
        </Card>

        <Card
          title={t("appSettings.address.title")}
          description={t("appSettings.address.description")}
        >
          <div className="max-w-160 space-y-2">
            <Label htmlFor={`${id}-address`}>
              {t("appSettings.address.label")}
            </Label>
            <Input
              {...register("publicUrl")}
              id={`${id}-address`}
              type="url"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              disabled={pending}
              placeholder="https://studio.example.com"
              aria-invalid={Boolean(errors.publicUrl)}
              aria-describedby={`${id}-address-hint`}
              className="h-9 font-mono text-[13px] max-tablet:h-11"
            />
            <p
              id={`${id}-address-hint`}
              role={errors.publicUrl ? "alert" : undefined}
              className={cn(
                "text-xs leading-5",
                errors.publicUrl ? "text-destructive" : "text-faint",
              )}
            >
              {errors.publicUrl
                ? t("appSettings.address.invalid")
                : t("appSettings.address.hint")}
            </p>
            {!errors.publicUrl && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t("appSettings.address.result")}{" "}
                <code className="font-mono wrap-anywhere text-foreground">
                  {address || window.location.origin}/v1
                </code>
              </p>
            )}
          </div>
        </Card>
      </div>
    </form>
  );
}

function Card({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-4 tablet:p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] leading-6 font-semibold">{title}</h2>
          <p className="mt-0.5 max-w-180 text-sm leading-6 text-muted-foreground">
            {description}
          </p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Choice({
  id,
  label,
  name,
  control,
  options,
}: {
  id: string;
  label: string;
  name:
    | "projectDefaults.aspectRatio"
    | "projectDefaults.language"
    | "projectDefaults.look"
    | "projectDefaults.continuity";
  control: ReturnType<typeof useForm<FormValues>>["control"];
  options: (readonly [string, string])[];
}) {
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Controller
        name={name}
        control={control}
        render={({ field }) => (
          <Select
            disabled={field.disabled}
            value={field.value}
            onValueChange={field.onChange}
          >
            <SelectTrigger
              id={id}
              ref={field.ref}
              onBlur={field.onBlur}
              className={SELECT_TRIGGER}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                {options.map(([value, text]) => (
                  <SelectItem key={value} value={value}>
                    {text}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      />
    </div>
  );
}

// What the server runs with. Read only: these come from its environment.
function SystemSection() {
  const { t } = useTranslation();
  const system = useSystemQuery();

  return (
    <div className="mt-5">
      <Card
        title={t("appSettings.system.title")}
        description={t("appSettings.system.description")}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={system.isFetching}
            onClick={() => void system.refetch()}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn(
                system.isFetching && "animate-spin motion-reduce:animate-none",
              )}
            />
            {t("appSettings.system.refresh")}
          </Button>
        }
      >
        {system.isPending ? (
          <p role="status" className="py-6 text-center text-sm text-faint">
            {t("appSettings.system.loading")}
          </p>
        ) : system.isError ? (
          <p role="alert" className="py-6 text-center text-sm text-destructive">
            {t("appSettings.system.loadError")}
          </p>
        ) : (
          <SystemDetails system={system.data} />
        )}
      </Card>
    </div>
  );
}

function SystemDetails({ system }: { system: SystemStatus }) {
  const { t } = useTranslation();
  const { ffmpeg, storage } = system;

  return (
    <div className="space-y-5">
      <dl className="grid gap-x-8 gap-y-4 tablet:grid-cols-2">
        <Fact label={t("appSettings.system.ffmpeg")}>
          <State ok={ffmpeg.path !== null}>
            {ffmpeg.path
              ? t("appSettings.system.found", {
                  detail:
                    ffmpeg.version ?? t("appSettings.system.unknownVersion"),
                })
              : t("appSettings.system.ffmpegMissing")}
          </State>
          {ffmpeg.path && <Path>{ffmpeg.path}</Path>}
        </Fact>
        <Fact label={t("appSettings.system.captions")}>
          <State ok={ffmpeg.captions} soft>
            {t(
              ffmpeg.captions
                ? "appSettings.system.captionsYes"
                : "appSettings.system.captionsNo",
            )}
          </State>
        </Fact>
        <Fact label={t("appSettings.system.browser")}>
          <State ok={system.browserPath !== null}>
            {t(
              system.browserPath
                ? "appSettings.system.browserFound"
                : "appSettings.system.browserMissing",
            )}
          </State>
          {system.browserPath && <Path>{system.browserPath}</Path>}
        </Fact>
        <Fact label={t("appSettings.system.version")}>
          <span className="font-mono text-sm">{system.version}</span>
          <span className="ml-2 text-xs text-faint">
            {t("appSettings.system.schema", {
              revision: system.databaseRevision ?? "—",
            })}
          </span>
        </Fact>
        <Fact label={t("appSettings.system.dataDir")}>
          <Path>{system.dataDir}</Path>
          <p className="mt-1 text-xs leading-5 text-faint">
            {t("appSettings.system.backupHint")}
          </p>
        </Fact>
        <Fact label={t("appSettings.system.storage")}>
          <ul className="space-y-1 text-sm">
            {(
              [
                ["projects", storage.projectsBytes],
                ["library", storage.libraryBytes],
                ["database", storage.databaseBytes],
                ["free", storage.freeBytes],
              ] as const
            ).map(([name, size]) => (
              <li key={name} className="flex justify-between gap-4">
                <span className="text-muted-foreground">
                  {t(`appSettings.system.sizes.${name}`)}
                </span>
                <span className="font-mono tabular-nums">
                  {formatSize(size)}
                </span>
              </li>
            ))}
          </ul>
        </Fact>
      </dl>

      <div>
        <h3 className="text-sm font-semibold">
          {t("appSettings.limits.title")}
        </h3>
        <p className="mt-0.5 mb-3 max-w-180 text-xs leading-5 text-faint">
          {t("appSettings.limits.description")}
        </p>
        <div className="scroll-subtle overflow-x-auto rounded-lg border">
          <table className="w-full min-w-120 text-left text-sm">
            <thead className="border-b bg-secondary text-xs text-faint">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("appSettings.limits.setting")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("appSettings.limits.value")}
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  {t("appSettings.limits.variable")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {LIMITS.map(([name, variable]) => {
                const value = system.limits[name];
                return (
                  <tr key={name}>
                    <td className="px-3 py-2">
                      {t(`appSettings.limits.names.${name}`)}
                    </td>
                    <td className="px-3 py-2 font-mono tabular-nums">
                      {typeof value === "boolean"
                        ? t(
                            value
                              ? "appSettings.limits.on"
                              : "appSettings.limits.off",
                          )
                        : name === "sessionRefreshMinutes" && value === 0
                          ? t("appSettings.limits.off")
                          : value}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {variable}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">
        {label}
      </dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

// Icon and words, never colour alone. `soft`: missing is a limitation, not a fault.
function State({
  ok,
  soft = false,
  children,
}: {
  ok: boolean;
  soft?: boolean;
  children: ReactNode;
}) {
  const Icon = ok ? Check : CircleAlert;
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1.5 rounded-md px-2 py-1 text-xs leading-5 font-medium",
        ok
          ? "bg-success-soft text-success"
          : soft
            ? "bg-warning-soft text-warning"
            : "bg-destructive-soft text-destructive",
      )}
    >
      <Icon className="mt-0.75 size-3.5 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

function Path({ children }: { children: string }) {
  return (
    <p className="mt-1.5 font-mono text-xs leading-5 wrap-anywhere text-muted-foreground select-all">
      {children}
    </p>
  );
}
