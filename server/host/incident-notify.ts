// Incidents: a run that could not deliver its answer — failed, stalled,
// could-not-start, routine-failed — reaches the Chief of Staff (or the
// person, when no Chief may see the bot). The incident thread turns each
// into one Chief turn carrying the report; policy in server/incidents.ts.
// Extracted from server/index.ts unchanged when the file-size ratchet
// closed; this module is the harness wiring (turns, queues, notifications).
import type { BotRecord, Message, Store } from "../store.ts";
import { chiefForBot, INCIDENTS_THREAD_TITLE, IncidentLedger, incidentChip, incidentRequest, incidentText, type Incident, type IncidentKind } from "../incidents.ts";
import { buildNotification, type Notification } from "../notify.ts";
import { admit } from "../admission.ts";
import { redactSecretsInText } from "../redact.ts";
import { queueSteeredMessage } from "../steer-queue.ts";
import { failedTurnTool } from "../../shared/failed-turn.ts";
import type { Coordinator } from "../coordinator.ts";

export interface IncidentNotifyDeps {
  store: Store;
  notify: (notification: Notification | null) => void;
  coordinator: Coordinator;
  threadBusy: (botId: string, threadId: string) => boolean;
  botAtThreadCapacity: (botId: string) => boolean;
  activeGroupTurnForBot: (botId: string) => unknown;
  startTurn: (botId: string, text: string, options: { threadId: string; unattended: true; peerAsk: Message["peerAsk"] }) => Promise<unknown>;
}

export function createIncidentNotify(deps: IncidentNotifyDeps) {
  const { store, notify } = deps;
  const incidentLedger = new IncidentLedger();

  function incidentContext(threadId: string): { lastRequest: string | null; lastReply: string | null } {
    const messages = store.messagesFor(threadId);
    return {
      lastRequest: incidentRequest(messages),
      lastReply: messages.findLast((message) => message.role === "bot" && message.kind === "text" && message.text)?.text ?? null,
    };
  }

  function incidentRefused(chief: BotRecord, incidentsThreadId: string, asks: ReadonlyArray<Message["peerAsk"]>, why: string): void {
    const refused = `the incident could not reach ${chief.name} — ${why}`;
    store.appendMessage(incidentsThreadId, { role: "bot", kind: "activity", tool: failedTurnTool(refused) });
    const lines = store.messagesFor(incidentsThreadId);
    for (const ask of asks) {
      if (!ask?.incident || ask.incident.notified) continue;
      const bot = store.bot(ask.botId);
      if (!bot) continue;
      const { threadId } = ask.incident;
      const chip = lines.findLast(line => line.kind === "activity" && line.tool?.ok === false && line.threadRef?.threadId === threadId)?.tool?.name;
      const group = store.groupByThread(threadId);
      notify(buildNotification("incident", bot, threadId, chip ?? refused, {
        avatarUrl: bot.avatarUrl,
        ...(group ? { group: { id: group.id, name: group.name } } : {}),
      }));
    }
  }

  function reportIncident(input: { kind: IncidentKind; bot: BotRecord; threadId: string; detail: string }): void {
    const { bot, threadId } = input;
    const task = store.taskByThread(bot.id, threadId);
    if (deps.coordinator.assignerOf(threadId)) return;
    const group = store.groupByThread(threadId);
    const incident: Incident = {
      kind: input.kind,
      bot,
      threadId,
      title: task?.title ?? null,
      room: group?.name ?? null,
      detail: redactSecretsInText(input.detail),
      ...incidentContext(threadId),
    };
    const count = incidentLedger.note(threadId);
    if (count.muted) return;
    const chief = chiefForBot(store.bots, bot);
    const alreadyNotified = input.kind === "could-not-start" || input.kind === "routine-failed";
    const tellThePerson = () => {
      if (alreadyNotified) return;
      notify(buildNotification("incident", bot, threadId, incidentChip(incident), {
        avatarUrl: bot.avatarUrl,
        ...(group ? { group: { id: group.id, name: group.name } } : {}),
      }));
    };
    if (!chief) {
      tellThePerson();
      return;
    }
    const incidents = store.tasks(chief.id).find((candidate) => candidate.title === INCIDENTS_THREAD_TITLE && !candidate.archivedAt)
      ?? store.createTask(chief.id, INCIDENTS_THREAD_TITLE, false, undefined, { botId: chief.id, name: chief.name, at: Date.now() });
    if (!incidents || incidents.threadId === threadId) {
      tellThePerson();
      return;
    }
    store.appendMessage(incidents.threadId, {
      role: "bot",
      kind: "activity",
      tool: { name: incidentChip(incident), ok: false },
      threadRef: { botId: bot.id, threadId, title: task?.title ?? (group ? group.name : `${bot.name}'s conversation`) },
    });
    const text = incidentText(incident, count);
    const peerAsk = { botId: bot.id, name: bot.name, unattended: true,
      incident: { threadId, ...(alreadyNotified ? { notified: true } : {}) } };
    const decision = admit("incident", {}, {
      threadBusy: deps.threadBusy(chief.id, incidents.threadId),
      atCapacity: deps.botAtThreadCapacity(chief.id),
      groupTurn: Boolean(deps.activeGroupTurnForBot(chief.id)),
    });
    if (decision.action === "queue") {
      queueSteeredMessage(chief.id, incidents.threadId, text, { reason: decision.reason, unattended: true, peerAsk });
      return;
    }
    void deps.startTurn(chief.id, text, { threadId: incidents.threadId, unattended: true, peerAsk }).catch((error) => {
      incidentRefused(chief, incidents.threadId, [peerAsk], error instanceof Error ? error.message : String(error));
    });
  }

  return { incidentLedger, reportIncident, incidentRefused };
}
