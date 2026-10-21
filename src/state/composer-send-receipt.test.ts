import { expect, it, vi } from "vitest";
import { applyComposerSendReceipt } from "./composer-send-receipt";
import type { Message } from "./store";
it("retains an uncertain delivered message and restores the draft without creating a queue entry", () => {
  const dispatch = vi.fn(), error = vi.fn(), onError = vi.fn();
  applyComposerSendReceipt({ threadId: "t", message: { id: "m" } as Message, uncertain: true }, { text: "draft", sendId: "s", onError }, dispatch, error);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: "messageAdded", message: { id: "m" } }));
  expect(onError).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce();
});
it("replaces an optimistic send with its queued receipt", () => {
  const dispatch = vi.fn(), error = vi.fn();
  applyComposerSendReceipt({ threadId: "t", queued: true, queueId: "q", reason: "capacity" }, { text: "draft", sendId: "s" }, dispatch, error);
  expect(dispatch.mock.calls.map(([a]) => a)).toEqual([{ type: "optimisticMessageRemoved", threadId: "t", sendId: "s" }, { type: "pendingQueued", threadId: "t", queueId: "q", text: "draft", reason: "capacity" }]);
  expect(error).not.toHaveBeenCalled();
});
