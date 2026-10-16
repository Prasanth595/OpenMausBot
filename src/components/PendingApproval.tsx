// Pending approval, ported from the upstream pattern: an approval does
// not sit in the transcript waiting to be noticed — it takes over the
// composer. The prompt is disabled, a strip above it says exactly what
// is being asked, and the send row is replaced by the decisions.
//
// Faithful details worth keeping: one at a time with an "n of N" counter,
// the detail printed raw in a monospace block that is NEVER truncated
// (it scrolls instead), and the buttons ordered least-destructive-last so
// the primary action sits under your thumb.
import { memo } from "react";
import { useStore, type Action, type Bot, type Message } from "@/state/store";
import { cn } from "@/lib/cn";
import { t, tFromServer } from "@/lib/i18n";
import type { LocaleKey } from "@/locales";
import { SkillRequestPreview } from "@/components/SkillRequestPreview";
import { toolLabel } from "./ApprovalCard";
import { outboundSummary } from "@/lib/approval-summary";
import { reviewedSkillSha256 } from "../../shared/skill-request";
import { useOwnerOrAdmin } from "@/lib/use-owner-or-admin";

interface ApprovalLabels {
  [tool: string]: LocaleKey;
}

export interface Pending {
  message: Message;
  requestId: string;
  tool: string;
  /** the narrow grant "always allow" writes, computed server-side */
  allowKey?: string;
  allowSession?: boolean;
  commandAllowlist?: { command: string; cwd: string; providerInstanceId: string };
  detail: string;
  held?: string;
  heldCode?: string;
}

/** The persisted payload is the authoritative marker. Tool names are
 * provider-authored display strings and can collide with ours. */
export function isRoutineApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.routineRequest);
}

export function isSkillApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.skillRequest);
}

export function isProfileApproval(pending: Pending): boolean {
  return Boolean(pending.message.card?.profileRequest);
}

/** Open approvals on a thread, oldest first — answered/dismissed drop out. */
export function pendingApprovals(messages: Message[]): Pending[] {
  return messages
    // An expired proposal is terminal: it must not take over the composer
    // or offer its decision buttons anywhere.
    .filter((m) => m.kind === "options" && m.card?.requestId && m.card.tool && !m.card.answered && !m.card.dismissed && !m.card.expired)
    .map((m) => ({
      message: m,
      requestId: m.card!.requestId!,
      tool: m.card!.tool!,
      allowKey: m.card!.allowKey,
      allowSession: m.card!.allowSession,
      commandAllowlist: m.card!.commandAllowlist,
      detail: m.card!.subtitle,
      held: m.card!.held,
      heldCode: m.card!.heldCode,
    }));
}

/** Routine cards can carry every instruction the user asked for (up to
 * 20,000 characters). Calls should announce the concise, visible title and
 * let the user review those details on screen instead of reading them all. */
export function spokenApprovalPrompt(pending: Pending, requester: string): string {
  if (pending.message.card?.teamSetupRequest) return `${requester}: ${pending.message.card.title} Review the details and choose ${pending.message.card.options[0]} or Cancel.`;
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  if (isSkillRequest) {
    const updating = pending.message.card?.skillRequest?.action === "update";
    const title = pending.message.card?.title.trim() || t(
      updating ? "approval.voice.defaultUpdateSkill" : "approval.voice.defaultEnableSkill",
    );
    return t("approval.voice.skill", {
      requester,
      title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
      action: t(updating ? "approval.voice.actionUpdate" : "approval.voice.actionEnable"),
    });
  }
  if (isProfileRequest) {
    // pending.detail is the full subtitle — the whole diff for a soul
    // change. Speak the card's concise title instead, the same way the
    // routine/skill branches do, and let the user read the diff on screen.
    const title = pending.message.card?.title.trim() || t("approval.voice.defaultUpdateProfile");
    return t("approval.voice.profile", { requester, title });
  }
  if (!isRoutineRequest) {
    // pending.tool can be an ACP toolCall kind rather than a tool name —
    // speak the same verb phrase the card header shows, so voice never
    // reads "wants to other".
    return t("approval.voice.command", { requester, tool: toolLabel(pending.tool), detail: pending.detail });
  }
  const title = pending.message.card?.title.trim() || t("approval.voice.defaultConfirmRoutine");
  return t("approval.voice.routine", {
    requester,
    title: `${title}${/[.!?]$/.test(title) ? "" : "."}`,
  });
}

function label(pending: Pending): string {
  if (pending.message.card?.teamSetupRequest) return pending.message.card.title;
  if (isSkillApproval(pending)) {
    return pending.message.card?.skillRequest?.action === "update"
      ? t("approval.label.updateSkill")
      : t("approval.label.enableSkill");
  }
  if (isProfileApproval(pending)) {
    return t("approval.label.confirmProfileChange");
  }
  if (isRoutineApproval(pending)) {
    return pending.message.card?.routineRequest?.operation.action === "create"
      ? t("approval.label.confirmRoutine")
      : t("approval.label.confirmRoutineChange");
  }
  const nice: ApprovalLabels = {
    Bash: "approval.label.commandRequested",
    shell: "approval.label.commandRequested",
    Read: "approval.label.fileReadRequested",
    Write: "approval.label.fileChangeRequested",
    Edit: "approval.label.fileChangeRequested",
    edit: "approval.label.fileChangeRequested",
  };
  const key = nice[pending.tool];
  return key ? t(key) : t("approval.label.requested");
}

export const PendingApprovalPanel = memo(function PendingApprovalPanel({
  pending,
  count,
  index,
}: {
  pending: Pending;
  count: number;
  index: number;
  /** The active locale. Not read here: it is the memo key, the same way the
   * transcript takes one. Every line in this panel comes from the catalog,
   * and nothing else about a pending approval changes with the language. */
  locale?: string;
}) {
  const heldNote = tFromServer(pending.heldCode, pending.held);
  // A held outbound action names where it sends and what, not its slug.
  const outbound = pending.message.card ? outboundSummary(pending.message.card) : undefined;
  return (
    <div
      role="region"
      aria-label={
        isSkillApproval(pending)
          ? t("approval.aria.pendingSkill")
          : isRoutineApproval(pending)
            ? t("approval.aria.pendingRoutine")
            : isProfileApproval(pending)
              ? t("approval.aria.pendingProfile")
              : t("approval.aria.pending")
      }
      className="rounded-t-2xl border-b border-hairline/50 bg-control/40 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-2" aria-live="polite">
        <span className="text-[11px] uppercase tracking-[0.18em] text-ink-secondary">
          {t("approval.pending")}
        </span>
        {count > 1 && (
          <span className="rounded-full bg-control px-1.5 py-0.5 text-[11px] tabular-nums text-ink-secondary">
            {t("approval.position", { index: index + 1, count })}
          </span>
        )}
        <span className="text-[13px] text-ink">{outbound ? outbound.headline : label(pending)}</span>
        {outbound ? (
          outbound.summary && <span className="text-[13px] text-ink-secondary">{outbound.summary}</span>
        ) : !pending.message.card?.teamSetupRequest && <span className="font-mono text-[11px] text-ink-secondary">
          {isSkillApproval(pending)
            ? pending.message.card?.skillRequest?.action === "update" ? "update_skill" : "stage_skill"
            : isRoutineApproval(pending)
            ? pending.message.card?.routineRequest?.operation.action === "create"
              ? "schedule_routine"
              : "manage_routine"
            : isProfileApproval(pending)
              ? "update_profile"
              : pending.tool}
        </span>}
      </div>
      {/* never truncated — long commands wrap and scroll */}
      <pre
        tabIndex={0}
        aria-label={
          isSkillApproval(pending)
            ? t("approval.aria.reviewSkill")
            : isRoutineApproval(pending)
              ? t("approval.aria.reviewRoutine")
              : isProfileApproval(pending)
                ? t("approval.aria.reviewProfile")
                : t("approval.aria.reviewDetails")
        }
        className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-ink"
      >
        {pending.commandAllowlist?.command ?? pending.detail}
      </pre>
      {pending.message.card?.skillRequest && (
        <SkillRequestPreview request={pending.message.card.skillRequest} />
      )}
      {heldNote && <div className="mt-2 text-[12px] text-warning">{heldNote}</div>}
    </div>
  );
});

/** One decision a pending approval offers, as the composer shows it. The
 * same list drives "Precisa de você" (needs-you approvals), so the panel
 * never offers a decision the chat would not, nor misses one it does. */
export type ApprovalChoiceId = "cancelTurn" | "deny" | "alwaysAllow" | "alwaysAllowSession" | "rememberCommand" | "allow";
export interface ApprovalChoice {
  id: ApprovalChoiceId;
  label: string;
  title?: string;
  look: "quiet" | "danger" | "outline" | "primary";
  disabled?: boolean;
  autoFocus?: boolean;
}

/** The fields of a `decideRequest` a choice sends (all but where it goes). */
export type ApprovalDecision = Omit<Extract<Action, { type: "decideRequest" }>, "type" | "threadId" | "onError">;

function durable(pending: Pending): boolean {
  return isRoutineApproval(pending) || isSkillApproval(pending) || isProfileApproval(pending) || Boolean(pending.message.card?.teamSetupRequest);
}

/** The decisions in the order they are drawn, least destructive last.
 * `bot`: who asked — "always allow" is remembered against them.
 * `ownerOrAdmin`: may remember an exact command (null while unknown). */
export function approvalChoices(pending: Pending, opts: { bot?: Pick<Bot, "id" | "name">; ownerOrAdmin: boolean | null }): ApprovalChoice[] {
  const isRoutineRequest = isRoutineApproval(pending);
  const isSkillRequest = isSkillApproval(pending);
  const isProfileRequest = isProfileApproval(pending);
  const isTeamSetup = Boolean(pending.message.card?.teamSetupRequest);
  const durableRequest = durable(pending);
  const canRememberCommand = opts.ownerOrAdmin === true && !durableRequest && !pending.allowKey && Boolean(pending.commandAllowlist);
  const reviewedSha256 = pending.message.card?.skillRequest ? reviewedSkillSha256(pending.message.card.skillRequest) : undefined;
  const choices: ApprovalChoice[] = [];
  if (!durableRequest) choices.push({ id: "cancelTurn", label: t("approval.action.cancelTurn"), look: "quiet" });
  choices.push({
    id: "deny",
    label: isRoutineRequest || isProfileRequest || isTeamSetup ? t("approval.action.cancel") : t("approval.action.deny"),
    look: "danger",
    ...(isTeamSetup ? { autoFocus: true } : {}),
  });
  if (!durableRequest && opts.bot && pending.allowKey) {
    choices.push({ id: "alwaysAllow", label: t("approval.action.alwaysAllow"), title: t("approval.action.stopAsking", { name: opts.bot.name, key: pending.allowKey }), look: "outline" });
  }
  if (!durableRequest && !pending.allowKey && !canRememberCommand && pending.allowSession) {
    choices.push({ id: "alwaysAllowSession", label: t("approval.action.alwaysAllowSession"), title: t("approval.action.alwaysAllowSessionHint"), look: "outline" });
  }
  if (canRememberCommand && pending.commandAllowlist) {
    choices.push({ id: "rememberCommand", label: t("approval.action.alwaysAllowCommand"), title: t("approval.action.alwaysAllowCommandHint", { cwd: pending.commandAllowlist.cwd }), look: "outline" });
  }
  choices.push({
    id: "allow",
    label: (isTeamSetup ? pending.message.card?.options[0] : isSkillRequest
      ? pending.message.card?.skillRequest?.action === "update"
        ? t("approval.action.update")
        : t("approval.action.enable")
      : isRoutineRequest || isProfileRequest
        ? t("approval.action.confirm")
        : t("approval.action.allowOnce")) ?? t("approval.action.allowOnce"),
    look: "primary",
    ...(isSkillRequest && !reviewedSha256 ? { disabled: true } : {}),
  });
  return choices;
}

/** What a choice sends — null for "Cancelar execução", which stops the turn
 * instead of answering the card. The one shape the composer and "Precisa de
 * você" both dispatch as `decideRequest` (POST /api/threads/:id/respond). */
export function approvalDecision(pending: Pending, id: ApprovalChoiceId, bot?: Pick<Bot, "id">): ApprovalDecision | null {
  if (id === "cancelTurn") return null;
  const behavior = id === "deny" ? "deny" as const : "allow" as const;
  const always = id === "alwaysAllow" || id === "alwaysAllowSession";
  const reviewedSha256 = pending.message.card?.skillRequest ? reviewedSkillSha256(pending.message.card.skillRequest) : undefined;
  return {
    requestId: pending.requestId,
    behavior,
    message: behavior === "deny" ? "Denied by the user." : undefined,
    reviewedSha256: behavior === "allow" ? reviewedSha256 : undefined,
    // a harness-native card (peer comms) remembers a grant on the bot; a
    // provider's card hands the allow to the provider for its session
    alwaysAllow: always && bot && pending.allowKey ? { botId: bot.id, key: pending.allowKey } : undefined,
    always: always && !pending.allowKey && pending.allowSession ? true : undefined,
    rememberCommand: id === "rememberCommand" || undefined,
  };
}

const CHOICE_LOOK: Record<ApprovalChoice["look"], string> = {
  quiet: "text-ink-secondary hover:bg-control hover:text-ink",
  danger: "border border-danger/40 text-danger hover:bg-danger/10",
  outline: "border border-hairline/50 text-ink hover:bg-control",
  primary: "bg-accent font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40",
};

export function PendingApprovalActions({
  pending,
  threadId,
  bot,
  onCancelTurn,
}: {
  pending: Pending;
  threadId: string;
  /** who asked — "always allow" is remembered against them */
  bot?: Bot;
  onCancelTurn: () => void;
}) {
  const { dispatch } = useStore();
  const ownerOrAdmin = useOwnerOrAdmin();
  const choose = (id: ApprovalChoiceId) => {
    const decision = approvalDecision(pending, id, bot);
    if (!decision) onCancelTurn();
    else dispatch({ type: "decideRequest", threadId, ...decision });
  };
  const base = "rounded-full px-3.5 py-1.5 text-[13.5px] transition-colors";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 px-2 py-2">
      {approvalChoices(pending, { bot, ownerOrAdmin }).map((choice) => (
        <button
          key={choice.id}
          onClick={() => choose(choice.id)}
          title={choice.title}
          disabled={choice.disabled}
          autoFocus={choice.autoFocus}
          className={cn(base, CHOICE_LOOK[choice.look])}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}
