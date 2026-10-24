import type { NotifyKind } from "../../shared/notification.ts";
import { botShowsUnread } from "./bot-unread.ts";

/** Kinds that wait on the person or report a failure; the unread switch never silences them. */
const NEEDS_PERSON: ReadonlySet<NotifyKind> = new Set(["approval", "question", "sign-in", "incident", "turn-failed", "routine-failed", "routine-deferred", "spend"]);

export const unreadCountShown = (enabled: boolean, count: number): number => (enabled && Number.isFinite(count) ? Math.max(0, count) : 0);

export const dockBadgeCount = (
  enabled: boolean,
  bots: ReadonlyArray<Parameters<typeof botShowsUnread>[0] & { hidden?: boolean }>,
  groups: ReadonlyArray<{ unread?: boolean }>,
): number => unreadCountShown(enabled, bots.filter((bot) => !bot.hidden && botShowsUnread(bot)).length + groups.filter((group) => group.unread).length);

export const notifyKindSilencedByUnreadSwitch = (enabled: boolean, kind: NotifyKind): boolean => !enabled && !NEEDS_PERSON.has(kind);
