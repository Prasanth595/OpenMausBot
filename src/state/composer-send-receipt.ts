import type { Dispatch } from "react";
import type { Action, Message } from "./store";
import { t } from "../lib/i18n";

type Receipt = { message?: Message; threadId?: string; uncertain?: boolean; queued?: boolean; queueId?: string; reason?: string };

export function applyComposerSendReceipt(body: Receipt | null | undefined, sent: { sendId: string; text: string; onError?: () => void }, dispatch: Dispatch<Action>, showError: (error: Error) => void): void {
  if (body?.message && typeof body.threadId === "string") {
    dispatch({ type: "messageAdded", threadId: body.threadId, message: body.message });
  }
  if (body?.uncertain === true) {
    showError(new Error(t("composer.delivery.uncertainHint")));
    sent.onError?.();
    return;
  }
  if (body?.queued && typeof body.threadId === "string" && typeof body.queueId === "string") {
    dispatch({ type: "optimisticMessageRemoved", threadId: body.threadId, sendId: sent.sendId });
    dispatch({ type: "pendingQueued", threadId: body.threadId, queueId: body.queueId, text: sent.text, reason: body.reason === "capacity" || body.reason === "group-turn" ? body.reason : undefined });
  }
}
