import type { Notification, NotifyKind } from "../shared/notification.ts";
import { personMentionExcerpt } from "../shared/person-mention.ts";

export type { Notification, NotifyKind } from "../shared/notification.ts";

export function summarize(text: string, max = 140): string {
  const line = text.replace(/```[\s\S]*?```/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
}

export interface NotifyBot {
  id: string;
  name: string;
  threadId: string;
  notifications?: boolean;
}

/** What muting a bot conversation thread does to one notice:
 * - "silenced": never reaches the person's devices from a muted thread;
 * - "kept-unless-chief-took-it": silenced only when the Chief of Staff accepted this very report (its incident turn
 *   started or queued); a missing, refusing, rate-limited or busy-elsewhere Chief leaves it to the person;
 * - "kept": always reaches the person — a gate only they can lift, or account-level spend.
 * "peer-approval" is the approval a bot asks of the person before it acts on a teammate; every other notice is its NotifyKind. */
export type ThreadMuteNotice = NotifyKind | "peer-approval";
export type ThreadMuteRule = "silenced" | "kept-unless-chief-took-it" | "kept";
export const THREAD_MUTE_POLICY: Record<ThreadMuteNotice, ThreadMuteRule> = {
  done: "silenced",
  "delegation-settled": "silenced",
  mention: "silenced",
  "routine-deferred": "silenced",
  // Waits only the person can lift, whether or not a Chief exists. A turn that ends on NEEDS INPUT in a muted thread
  // also tells the person as a question (chief-notices reportNeedsInput).
  approval: "kept",
  question: "kept",
  "sign-in": "kept",
  "turn-failed": "kept-unless-chief-took-it",
  "routine-failed": "kept-unless-chief-took-it",
  // Sent only when no Chief received the incident or escalation (none, out of reach, or it could not start).
  incident: "kept",
  "peer-approval": "kept",
  // Account-level: dispatched outside any thread (index.ts spend alerts), listed so the table is whole.
  spend: "kept",
};

/** Whether a muted thread still sends `notice`. A "kept-unless-chief-took-it" notice is sent: its caller
 * (chief-notices reportFailure) withholds it, from a muted thread, once the Chief accepted its report. */
export function mutedThreadNotifies(notice: ThreadMuteNotice): boolean {
  return THREAD_MUTE_POLICY[notice] !== "silenced";
}

export interface ThreadMuteDefault {
  botOpened: boolean;
  mainThreadId: string | undefined;
}

export interface MutableThread {
  threadId: string;
  notificationsMuted?: boolean;
  openedBy?: object;
}

export function muteBotOpenedThreads(cfg: { features?: { muteBotOpenedThreads?: boolean } }): boolean {
  return cfg.features?.muteBotOpenedThreads === true;
}

export function threadNotificationsMuted(task: MutableThread, byDefault: ThreadMuteDefault): boolean {
  return task.notificationsMuted ?? (byDefault.botOpened && task.openedBy !== undefined && task.threadId !== byDefault.mainThreadId);
}

export function buildSpendNotification(
  bot: Pick<NotifyBot, "id" | "name">,
  threadId: string,
  text: { title: string; body: string },
): Notification {
  return { kind: "spend", botId: bot.id, botName: bot.name, threadId, title: text.title, body: summarize(text.body, 200) };
}

export function buildNotification(
  kind: NotifyKind,
  bot: NotifyBot,
  threadId: string,
  detail: string,
  extra?: { avatarUrl?: string; group?: { id: string; name: string }; site?: string },
): Notification | null {
  if (bot.notifications === false) return null;

  const body = summarize(detail);
  const who = extra?.group ? `${bot.name} in ${extra.group.name}` : bot.name;
  const title =
    kind === "approval"
      ? `${who} needs approval`
      : kind === "question"
        ? `${who} has a question`
        : kind === "sign-in"
          ? `${who} needs you to sign in to ${extra?.site ?? "a website"}`
          : kind === "routine-failed"
            ? `${who}'s routine failed`
            : kind === "routine-deferred"
              ? `${who}'s routine is waiting`
            : kind === "turn-failed"
              ? `${who} couldn't start`
              : kind === "incident"
                ? `${who} hit a problem`
                : kind === "delegation-settled"
                  ? `${who} resumed with results`
                  : kind === "mention"
                    ? `${who} mentioned you`
                    : `${who} finished`;

  if ((kind === "done" || kind === "mention") && !body) return null;

  const notification: Notification = { kind, botId: bot.id, botName: bot.name, threadId, title, body };
  if (extra?.avatarUrl) notification.avatarUrl = extra.avatarUrl;
  if (extra?.group) notification.groupId = extra.group.id;
  return notification;
}

type MentionSource = {
  activePath(threadId: string): readonly { role: string; kind: string; text?: string; turnId?: string; from?: { botId: string } }[];
  bot(id: string): { name: string; hidden?: boolean } | null | undefined;
};

export function buildMentionNotification(
  source: MentionSource,
  bot: Omit<NotifyBot, "threadId"> & { avatarUrl?: string },
  room: { id: string; name: string; dm?: boolean; memberIds: readonly string[] },
  turn: { threadId: string; turnId?: string; reply: string; profileName?: string },
): Notification | null {
  if (room.dm) return null;
  const texts = turn.turnId
    ? source.activePath(turn.threadId).filter((m) => m.role === "bot" && m.kind === "text" && m.turnId === turn.turnId && m.from?.botId === bot.id).map((m) => m.text ?? "")
    : [turn.reply];
  const botNames = room.memberIds.flatMap((id) => {
    const member = source.bot(id);
    return member && !member.hidden ? [member.name] : [];
  });
  for (const text of texts) {
    const excerpt = personMentionExcerpt(text, { profileName: turn.profileName, botNames });
    if (excerpt) return buildNotification("mention", { ...bot, threadId: turn.threadId }, turn.threadId, excerpt, { avatarUrl: bot.avatarUrl, group: room });
  }
  return null;
}
