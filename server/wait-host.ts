import type { Notification } from "../shared/notification.ts";
import { buildNotification } from "./notify.ts";
import type { RoutineManager, RoutineRun } from "./routines.ts";
import type { BotRecord, Store } from "./store.ts";
import type { WaitManagerOptions } from "./waits.ts";

export interface WaitHostDeps {
  store: Pick<Store, "appendMessage" | "patchMessage" | "patchTask" | "messagesFor" | "bot">;
  /** A one-to-one chat this bot owns; a room is not one. */
  directChat(botId: string, threadId: string): boolean;
  threadBusy(botId: string, threadId: string): boolean;
  wrote(bot: BotRecord, threadId: string): void;
  notify(notification: Notification | null): void;
  enqueue(input: Parameters<RoutineManager["enqueueWebhook"]>[0]): { id: string };
  cloudHome: boolean;
  now?: () => number;
}

/** The chat a wait's follow-up run works in: the one it was asked in, never on a Cloud home or in a room. */
export function waitRunChat(
  run: Pick<RoutineRun, "botId" | "resultsThreadId">,
  directChat: (botId: string, threadId: string) => boolean,
  cloudHome: boolean,
): string | null {
  if (cloudHome || !run.resultsThreadId) return null;
  return directChat(run.botId, run.resultsThreadId) ? run.resultsThreadId : null;
}

export function createWaitHost(deps: WaitHostDeps): Pick<WaitManagerOptions, "sourceAlive" | "botBusy" | "post" | "followUp" | "showCard" | "settleCard"> {
  const { store } = deps;
  const now = deps.now ?? Date.now;
  return {
    sourceAlive: (botId, threadId) => store.bot(botId) !== null && deps.directChat(botId, threadId),
    botBusy: (botId) => {
      const bot = store.bot(botId);
      return bot ? bot.busy === true : undefined;
    },
    post(wait, notice) {
      const bot = store.bot(wait.botId);
      if (!bot) return true;
      if (deps.threadBusy(wait.botId, wait.threadId)) return false;
      const posted = store.messagesFor(wait.threadId).some((m) => m.wait?.id === wait.id && m.wait.status === notice.status);
      if (posted) return true;
      store.appendMessage(wait.threadId, { role: "bot", kind: "text", text: notice.text, wait: { id: wait.id, status: notice.status } });
      store.patchTask(wait.botId, wait.threadId, { unread: true });
      deps.wrote(bot, wait.threadId);
      if (notice.status === "fired") deps.notify(buildNotification("wait", bot, wait.threadId, notice.text, { avatarUrl: bot.avatarUrl }));
      return true;
    },
    followUp(wait) {
      deps.enqueue({
        webhookId: `wait:${wait.id}`,
        webhookName: wait.label,
        prompt: `[Wait finished: ${wait.label}] ${wait.followUp}`,
        botId: wait.botId,
        runOn: "maus",
        deliveryId: wait.id,
        receivedAt: now(),
        eventSource: "wait",
        ...(deps.cloudHome ? {} : { resultsThreadId: wait.threadId }),
      });
    },
    showCard(wait) {
      const bot = store.bot(wait.botId);
      if (!bot) return undefined;
      const message = store.appendMessage(wait.threadId, {
        role: "bot",
        kind: "options",
        card: {
          title: `Waiting: ${wait.label}`,
          subtitle: `When ${wait.label}, ${bot.name} will: ${wait.followUp}`,
          options: [],
          answered: "allow",
          dismissed: true,
          autoApplied: true,
          requestId: wait.id,
          tool: "wait_until",
          waitRequest: { waitId: wait.id, label: wait.label, followUp: wait.followUp },
        },
      });
      return message.id;
    },
    settleCard(wait, how) {
      if (!wait.cardMessageId) return;
      const message = store.messagesFor(wait.threadId).find((m) => m.id === wait.cardMessageId);
      const card = message?.card;
      if (!card?.waitRequest) return;
      store.patchMessage(wait.threadId, wait.cardMessageId, {
        card: { ...card, ...(how === "cancelled" ? { undone: true } : {}), waitRequest: { ...card.waitRequest, settled: how } },
      });
    },
  };
}
