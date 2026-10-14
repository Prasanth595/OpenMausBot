// Escalations: a parked run reaches the Chief of Staff. The mirror of
// incidents for the runs that did not fail: a teammate parked on a gate
// only a person can lift — a peer-comm approval card waiting in its
// thread, a turn that ended on NEEDS INPUT, or a flag it raised itself.
// The gate already says so where it waits; what was missing was the Chief,
// who coordinates the section, hearing about it in one place. The notice
// informs and assigns nothing: the person still lifts the gate. Policy in
// server/escalations.ts; this module is the harness wiring (turns, queues,
// notifications) that server/index.ts composes.
import type { BotRecord, Message, Store } from "../store.ts";
import { chiefForBot } from "../incidents.ts";
import { buildNotification, type Notification } from "../notify.ts";
import { admit } from "../admission.ts";
import { redactSecretsInText } from "../redact.ts";
import { queueSteeredMessage } from "../steer-queue.ts";
import { ESCALATIONS_THREAD_TITLE, EscalationLedger, escalationChip, escalationDeliverable, escalationText, NEEDS_INPUT_GATE, peerApprovalGate, type Escalation, type EscalationKind } from "../escalations.ts";
import { needsInputQuestion } from "../runtime-coordinator.ts";
import type { PeerAction } from "../peer-approval-key.ts";
import type { PeerApprovalTarget } from "../peer-approval.ts";

export interface EscalationNotifyDeps {
  store: Store;
  notify: (notification: Notification | null) => void;
  threadBusy: (botId: string, threadId: string) => boolean;
  botAtThreadCapacity: (botId: string) => boolean;
  activeGroupTurnForBot: (botId: string) => unknown;
  startTurn: (botId: string, text: string, options: { threadId: string; unattended: true; peerAsk: Message["peerAsk"] }) => Promise<unknown>;
  incidentRefused: (chief: BotRecord, threadId: string, asks: ReadonlyArray<Message["peerAsk"]>, why: string) => void;
}

export function createEscalationNotify(deps: EscalationNotifyDeps) {
  const { store, notify } = deps;
  const escalationLedger = new EscalationLedger();

  /** Raise one gate to whoever should carry it to the person: the Chief's
   * turn when there is one that may see this bot, else a notification of
   * the person's own. `alreadyNotified` is whether the gate's own surface already
   * buzzed the person (an approval card does; a NEEDS INPUT line does not) —
   * the no-Chief fallback stays silent then, and a refused turn never buzzes
   * twice. */
  function reportEscalation(input: {
    kind: EscalationKind; bot: BotRecord; threadId: string; gate: string; reason: string; alreadyNotified: boolean;
  }): "chief" | "person" | "muted" {
    const { bot, threadId } = input;
    const task = store.taskByThread(bot.id, threadId);
    const group = store.groupByThread(threadId);
    const escalation: Escalation = {
      kind: input.kind,
      bot,
      threadId,
      title: task?.title ?? null,
      room: group?.name ?? null,
      gate: input.gate,
      reason: redactSecretsInText(input.reason),
    };
    const count = escalationLedger.note(threadId);
    // a bot that keeps parking on gates is looping; the gate's own surface
    // (the card, the question) already tells the person
    if (count.muted) return "muted";
    const chief = chiefForBot(store.bots, bot);
    // the same reach retry_thread demands: an escalation never widens what
    // the Chief may see, and a Chief has no Chief — its own gates are the
    // person's to hear about
    const onDuty = chief && escalationDeliverable(chief, bot) ? chief : null;
    const tellThePerson = () => {
      if (input.alreadyNotified) return;
      notify(buildNotification("incident", bot, threadId, escalationChip(escalation), {
        avatarUrl: bot.avatarUrl,
        ...(group ? { group: { id: group.id, name: group.name } } : {}),
      }));
    };
    if (!onDuty) {
      tellThePerson();
      return "person";
    }
    // Delivery is advisory: this runs inside the approval-card path and the
    // turn.completed fold, and a failed notice must never break the gate or
    // the turn's own settlement — fall back to the person's notification.
    try {
      const escalations = store.tasks(onDuty.id).find((candidate) => candidate.title === ESCALATIONS_THREAD_TITLE && !candidate.archivedAt)
        ?? store.createTask(onDuty.id, ESCALATIONS_THREAD_TITLE, false, undefined, { botId: onDuty.id, name: onDuty.name, at: Date.now() });
      // no thread to carry the notice, or the gated thread is the escalations
      // thread itself: the person is next
      if (!escalations || escalations.threadId === threadId) {
        tellThePerson();
        return "person";
      }
      store.appendMessage(escalations.threadId, {
        role: "bot",
        kind: "activity",
        tool: { name: escalationChip(escalation), ok: false },
        threadRef: { botId: bot.id, threadId, title: task?.title ?? (group ? group.name : `${bot.name}'s conversation`) },
      });
      const text = escalationText(escalation, count);
      // the notice carries the parked bot's name as its provenance, and marks
      // itself a harness report about that thread exactly as an incident does
      // (turnAnswers, incidentRefused) — the queue never refuses it, and it
      // makes the Chief's computer optional
      const peerAsk = { botId: bot.id, name: bot.name, unattended: true,
        incident: { threadId, ...(input.alreadyNotified ? { notified: true } : {}) } };
      // the escalations thread is reused, so the previous notice may still be
      // running there: this one waits in that thread's queue and drains when
      // the Chief is free, never refused
      const decision = admit("incident", {}, {
        threadBusy: deps.threadBusy(onDuty.id, escalations.threadId),
        atCapacity: deps.botAtThreadCapacity(onDuty.id),
        groupTurn: Boolean(deps.activeGroupTurnForBot(onDuty.id)),
      });
      if (decision.action === "queue") {
        queueSteeredMessage(onDuty.id, escalations.threadId, text, { reason: decision.reason, unattended: true, peerAsk });
        return "chief";
      }
      void deps.startTurn(onDuty.id, text, { threadId: escalations.threadId, unattended: true, peerAsk }).catch((error) => {
        deps.incidentRefused(onDuty, escalations.threadId, [peerAsk], error instanceof Error ? error.message : String(error));
      });
      return "chief";
    } catch (error) {
      console.error(`escalation notice for ${bot.name} could not reach ${onDuty.name}:`, error);
      tellThePerson();
      return "person";
    }
  }

  /** A healthy teammate turn that ends parked on NEEDS INPUT is the
   * Chief's to carry to the person: the question waits in that thread
   * and nothing else says so anywhere (a direct thread's NEEDS INPUT
   * line buzzes nobody). The bot's own question is the reason the
   * notice quotes. Group turns have a speaker, not `bot`, so a room's
   * question stays in the room. */
  function needsInputTurnEnded(event: { ok: boolean; threadId: string }, bot: BotRecord | undefined, stopped: boolean | undefined, completedTurnId: string | undefined): void {
    if (!event.ok || !bot || stopped || !completedTurnId) return;
    const finalText = store.activePath(event.threadId)
      .findLast((message) => message.role === "bot" && message.kind === "text" && message.turnId === completedTurnId)?.text;
    const question = finalText === undefined ? undefined : needsInputQuestion(finalText);
    if (question !== undefined) {
      reportEscalation({
        kind: "needs-input", bot, threadId: event.threadId, gate: NEEDS_INPUT_GATE, reason: question,
        alreadyNotified: false,
      });
    }
  }

  /** The first escalation trigger: a peer-comm card that lands and waits is
   * a gate the Chief hears about at once (the card's own banner already
   * buzzed the person, so the notice never buzzes twice). */
  function onPeerApprovalPending(from: BotRecord, target: PeerApprovalTarget, action: PeerAction, sourceThreadId: string, message: string): void {
    reportEscalation({
      kind: "peer-approval",
      bot: from,
      threadId: sourceThreadId,
      gate: peerApprovalGate(action, target.name),
      reason: message,
      alreadyNotified: true,
    });
  }

  return { reportEscalation, needsInputTurnEnded, onPeerApprovalPending };
}
