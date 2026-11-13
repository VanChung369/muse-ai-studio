import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Sparkles } from "lucide-react";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { ActionBar } from "@/components/ui/action-bar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ROUTES } from "@/constants/routes";
import { useAccountsQuery } from "@/features/accounts/hooks/use-account-queries";
import { ApiError } from "@/lib/http";
import { useScriptGeneration } from "../hooks/use-script-generation";
import { useSaveProjectScript } from "../hooks/use-project-queries";
import { scriptGenerationRequestSchema } from "../schemas";
import { GENERATION_ERROR_CODES } from "../constants";
import { isScriptProposalApplied } from "../lib/project-script";
import type { Project } from "../types";

export function GenerateScriptDialog({
  project,
  onClose,
}: {
  project: Project;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const accounts = useAccountsQuery();
  const generation = useScriptGeneration(project.id);
  const apply = useSaveProjectScript();
  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<{ accountId: string; idea: string }>({
    resolver: zodResolver(scriptGenerationRequestSchema),
    defaultValues: { accountId: "", idea: project.idea },
  });
  const task = generation.query.data;
  const active = task?.status === "queued" || task?.status === "running";
  const eligible =
    accounts.data?.items.filter(
      (account) => account.enabled && account.sessionStatus === "valid",
    ) ?? [];
  const proposal =
    task?.status === "succeeded" ? task.result?.script : undefined;
  const alreadyApplied = isScriptProposalApplied(project, proposal);
  const stale =
    proposal !== undefined &&
    proposal.expectedRevision !== project.scriptRevision;
  const errorCode =
    generation.start.error instanceof ApiError
      ? generation.start.error.code
      : task?.error?.code;

  const knownError = GENERATION_ERROR_CODES.find((code) => code === errorCode);

  async function submit(values: { accountId: string; idea: string }) {
    try {
      await generation.start.mutateAsync({
        ...values,
        projectId: project.id,
        expectedRevision: project.scriptRevision,
      });
    } catch {
      /* Keep the brief for retry. */
    }
  }
  async function applyProposal() {
    if (!proposal) return;
    try {
      await apply.mutateAsync({ id: project.id, values: proposal });
    } catch {
      /* Keep the proposal visible. */
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !apply.isPending && !generation.start.isPending) onClose();
      }}
    >
      <DialogContent
        showCloseButton={!apply.isPending && !generation.start.isPending}
        className="max-h-[calc(100svh-2rem)] overflow-y-auto p-6 sm:max-w-2xl"
      >
        <DialogHeader className="pr-6">
          <DialogTitle>{t("projects.generation.title")}</DialogTitle>
          <DialogDescription>
            {t("projects.generation.description")}
          </DialogDescription>
        </DialogHeader>
        {generation.query.isPending && (
          <p role="status">{t("common.loading")}</p>
        )}
        {generation.query.isError && (
          <div role="alert" className="space-y-2">
            <p>{t("projects.generation.loadError")}</p>
            <ActionBar>
              <Button
                variant="outline"
                onClick={() => void generation.query.refetch()}
              >
                {t("common.retry")}
              </Button>
            </ActionBar>
          </div>
        )}
        {active && (
          <div
            role="status"
            className="space-y-4 rounded-lg border bg-card p-5"
          >
            <p className="flex items-center gap-2">
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              {t(
                task.cancelRequested
                  ? "projects.generation.cancelling"
                  : task.status === "queued"
                    ? "projects.generation.queued"
                    : "projects.generation.running",
              )}
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              {t("projects.generation.background")}
            </p>
            <ActionBar>
              <Button
                variant="outline"
                disabled={generation.cancel.isPending || task.cancelRequested}
                onClick={() => generation.cancel.mutate(task.id)}
              >
                {t("projects.generation.cancel")}
              </Button>
            </ActionBar>
            {generation.cancel.isError && (
              <p role="alert">{t("projects.generation.cancelError")}</p>
            )}
          </div>
        )}
        {!active && !proposal && task && (
          <p role="status" className="text-sm text-muted-foreground">
            {t(
              task.status === "interrupted"
                ? "projects.generation.interrupted"
                : task.status === "cancelled"
                  ? "projects.generation.cancelled"
                  : "projects.generation.failed",
            )}
          </p>
        )}
        {proposal && (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">
              {t("projects.generation.proposal")}
            </h3>
            <p className="text-xs text-muted-foreground">
              {proposal.visualStyle}
            </p>
            {proposal.characterBible && (
              <p className="text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
                {proposal.characterBible}
              </p>
            )}
            <ol className="space-y-3">
              {proposal.scenes.map((scene, index) => (
                <li
                  key={index}
                  className="space-y-2 rounded-lg border bg-card p-4"
                >
                  <p className="text-xs text-primary">
                    {t("projects.details.scene", { number: index + 1 })} ·{" "}
                    {t("projects.script.seconds", {
                      count: scene.durationSeconds,
                    })}
                  </p>
                  <h4 className="text-sm font-medium">{scene.title}</h4>
                  <p className="text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
                    {scene.prompt}
                  </p>
                  {scene.narration && (
                    <p className="text-xs leading-6">{scene.narration}</p>
                  )}
                </li>
              ))}
            </ol>
            {alreadyApplied ? (
              <p role="status" className="text-sm text-success">
                {t("projects.generation.applied")}
              </p>
            ) : (
              <>
                {stale && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("projects.generation.stale")}
                  </p>
                )}
                {apply.isError && (
                  <p role="alert" className="text-xs text-destructive">
                    {t("projects.generation.applyError")}
                  </p>
                )}
                <ActionBar>
                  <Button
                    disabled={stale || apply.isPending}
                    onClick={() => void applyProposal()}
                  >
                    {t(
                      apply.isPending
                        ? "projects.form.saving"
                        : "projects.generation.apply",
                    )}
                  </Button>
                </ActionBar>
              </>
            )}
          </div>
        )}
        {!active && (
          <form
            noValidate
            onSubmit={handleSubmit(submit)}
            className="space-y-4 border-t pt-5"
          >
            <div className="space-y-2">
              <Label htmlFor={`${id}-idea`}>{t("projects.form.idea")}</Label>
              <Textarea
                {...register("idea")}
                id={`${id}-idea`}
                rows={4}
                maxLength={12000}
                aria-invalid={!!errors.idea}
                disabled={generation.start.isPending}
              />
              {errors.idea && (
                <p role="alert" className="text-xs text-destructive">
                  {t("projects.generation.ideaRequired")}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${id}-account`}>
                {t("projects.generation.account")}
              </Label>
              <Controller
                name="accountId"
                control={control}
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={generation.start.isPending}
                  >
                    <SelectTrigger
                      id={`${id}-account`}
                      ref={field.ref}
                      onBlur={field.onBlur}
                      className="w-full"
                    >
                      <SelectValue
                        placeholder={t("projects.generation.chooseAccount")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {eligible.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {errors.accountId && (
                <p role="alert" className="text-xs text-destructive">
                  {t("projects.generation.chooseAccount")}
                </p>
              )}
              {!accounts.isPending && eligible.length === 0 && (
                <p className="text-xs leading-6 text-muted-foreground">
                  {t("projects.generation.noAccount")}{" "}
                  <Link to={ROUTES.ACCOUNTS} className="text-primary underline">
                    {t("pages.accounts.title")}
                  </Link>
                </p>
              )}
              {accounts.isError && (
                <ActionBar>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void accounts.refetch()}
                  >
                    {t("common.retry")}
                  </Button>
                </ActionBar>
              )}
            </div>
            {/* The status line above already reports interruptions and
                unknown failures; add an alert only when there is more to say. */}
            {(generation.start.isError ||
              (knownError !== undefined && task?.status !== "interrupted")) && (
              <p role="alert" className="text-xs text-destructive">
                {knownError
                  ? t(`projects.generation.errors.${knownError}`)
                  : t("projects.generation.failed")}
              </p>
            )}
            {task?.submitted && (
              <p className="text-xs leading-6 text-muted-foreground">
                {t("projects.generation.newRequest")}
              </p>
            )}
            <ActionBar>
              <Button
                type="submit"
                disabled={
                  eligible.length === 0 ||
                  generation.start.isPending ||
                  generation.query.isPending ||
                  generation.query.isError
                }
              >
                <Sparkles aria-hidden="true" />
                {t(
                  generation.start.isPending
                    ? "projects.generation.starting"
                    : task
                      ? "projects.generation.again"
                      : "projects.generation.start",
                )}
              </Button>
            </ActionBar>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
