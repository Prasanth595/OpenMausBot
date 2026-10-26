// A send shows at once as an optimistic user message; the server's copy, which carries the same sendId, replaces it.
import type { Message } from "./store";

export const optimisticMessageId = (sendId: string): string => `optimistic-${sendId}`;

export function optimisticUserMessage(
  text: string,
  sendId: string,
  replyToId?: string,
  parentId?: string | null,
  channelMode?: "chat" | "goal",
): Message {
  return {
    id: optimisticMessageId(sendId),
    role: "user",
    kind: "text",
    text,
    at: Date.now(),
    parentId: parentId ?? null,
    replyToId,
    sendId,
    channelMode,
  };
}

type Transcript = { threadId: string; messages?: Message[]; activeLeafId?: string | null };

/** A snapshot of the thread `held` shows, plus its sends the snapshot does not carry yet; a kept send stays the leaf. */
export function keepSendsInFlight<T extends Transcript>(snapshot: T, held: Transcript & { awaitingThreadSnapshot?: boolean }): T {
  if (held.threadId !== snapshot.threadId || held.awaitingThreadSnapshot) return snapshot;
  const confirmed = new Set(snapshot.messages?.flatMap((message) => (message.sendId ? [message.sendId] : [])));
  const waiting = held.messages?.filter((message) =>
    message.sendId !== undefined && message.id === optimisticMessageId(message.sendId) && !confirmed.has(message.sendId)) ?? [];
  if (waiting.length === 0) return snapshot;
  const leaf = waiting.some((message) => message.id === held.activeLeafId) ? { activeLeafId: held.activeLeafId } : {};
  return { ...snapshot, messages: [...(snapshot.messages ?? []), ...waiting], ...leaf };
}
