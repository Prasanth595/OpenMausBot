import type { NotifyKind } from "../../shared/notification";

/** Kinds that wait on the person or report a failure; the unread switch never silences them. */
const NEEDS_PERSON: ReadonlySet<NotifyKind> = new Set(["approval", "question", "sign-in", "incident", "turn-failed", "routine-failed", "spend"]);

export const unreadCountShown = (enabled: boolean, count: number): number => (enabled ? count : 0);

export const notifyKindSilencedByUnreadSwitch = (enabled: boolean, kind: NotifyKind): boolean => !enabled && !NEEDS_PERSON.has(kind);
