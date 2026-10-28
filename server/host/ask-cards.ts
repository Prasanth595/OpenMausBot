// A bot doing work another bot handed it, waiting on the person: the conversation that handed it the work hears that it
// waits, and how the wait ended.
import type { RuntimeEvent } from "../contracts.ts";
import type { HandoffView } from "../coordinator.ts";
import { buildNotification, type Notification } from "../notify.ts";
import type { BotRecord, Store } from "../store.ts";
import { settledWaitingChip } from "../waiting-on-person.ts";

export interface AskCardsDeps {
  store: Pick<Store, "bot" | "messagesFor" | "activePath" | "appendMessage" | "patchMessage" | "taskByThread" | "patchTask" | "group"
    | "groupTaskByThread" | "patchGroup">;
  node(id: string): HandoffView | undefined;
  /** The conversation that handed this one its work, while that work is live. */
  delegatorOf(threadId: string): { threadId: string; botId?: string } | undefined;
  notify(notification: Notification | null): void;
}

export function createAskCards(deps: AskCardsDeps) {
  const { store, delegatorOf, notify } = deps;
  const waitingOnPersonChips = new Map<string, { threadId: string; messageId: string; name: string; kind: string }>();

  function showWaitingOnPersonChip(threadId: string, requestId: string, asker: BotRecord, kind: "approval" | "answer") {
    const delegator = delegatorOf(threadId);
    if (!delegator || delegator.threadId === threadId) return;
    const chip = store.appendMessage(delegator.threadId, { role: "bot", kind: "activity",
      from: { botId: asker.id, name: asker.name, color: asker.color },
      tool: { name: `Waiting on your ${kind} in @${asker.name}` },
      threadRef: { botId: asker.id, threadId, title: store.taskByThread(asker.id, threadId)?.title ?? asker.name },
    });
    waitingOnPersonChips.set(`${threadId}:${requestId}`, { threadId: delegator.threadId, messageId: chip.id, name: asker.name, kind });
  }

  function settleWaitingOnPersonChips(threadId: string, resolved?: Extract<RuntimeEvent, { type: "request.resolved" }>) {
    for (const [key, chip] of waitingOnPersonChips) {
      if (resolved ? key !== `${threadId}:${resolved.requestId}` : !key.startsWith(`${threadId}:`)) continue;
      waitingOnPersonChips.delete(key);
      const existing = store.messagesFor(chip.threadId).find((message) => message.id === chip.messageId);
      if (!existing?.tool) continue;
      store.patchMessage(chip.threadId, chip.messageId, {
        tool: { ...existing.tool, ...settledWaitingChip(chip.name, chip.kind, resolved?.behavior ?? "deny", resolved?.source ?? "system") },
      });
    }
  }

  function newestQuestionChip(threadId: string, aboutThreadId: string): string | undefined {
    return store.activePath(threadId).findLast((message) =>
      message.kind === "activity" && (message.threadRef?.threadId ?? message.comm?.threadId) === aboutThreadId
      && message.tool?.name.includes(" needs your input: ") === true)?.tool?.name;
  }

  function park(node: HandoffView, question: string, restored?: boolean) {
    if (!node.parentId && node.cards?.length) return;
    const bot = store.bot(node.botId);
    if (!bot) return;
    const parent = node.parentId ? deps.node(node.parentId) : undefined;
    const title = store.taskByThread(bot.id, node.threadId)?.title ?? "Teammate work";
    const chip = `${bot.name} needs your input: ${question.slice(0, 180)}`;
    const group = parent?.groupId ? store.group(parent.groupId) : undefined;
    let liveParent: HandoffView | undefined;
    if (parent?.groupId) liveParent = group && store.groupTaskByThread(group.id, parent.threadId) ? parent : undefined;
    else if (parent) liveParent = store.taskByThread(parent.botId, parent.threadId) ? parent : undefined;
    if (restored && (!liveParent || newestQuestionChip(liveParent.threadId, node.threadId) === chip)) return;
    if (liveParent) {
      store.appendMessage(liveParent.threadId, {
        role: "bot", kind: "activity",
        from: { botId: bot.id, name: bot.name, color: bot.color },
        tool: { name: chip, ok: true },
        ...(node.groupId ? { comm: { groupId: node.groupId, threadId: node.threadId, withBotId: bot.id, withName: bot.name, withColor: bot.color } }
          : { threadRef: { botId: bot.id, threadId: node.threadId, title } }),
      });
      if (group) store.patchGroup(group.id, { unread: true });
      else store.patchTask(liveParent.botId, liveParent.threadId, { unread: true });
    }
    if (node.groupId) store.patchGroup(node.groupId, { unread: true });
    else store.patchTask(bot.id, node.threadId, { unread: true });
    notify(buildNotification("delegation-settled", bot, node.threadId, question, { avatarUrl: bot.avatarUrl }));
  }

  return { park, showWaitingOnPersonChip, settleWaitingOnPersonChips };
}
