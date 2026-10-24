import { describe, expect, it } from "vitest";
import { notifyKindSilencedByUnreadSwitch, unreadCountShown } from "./unread-indicators";

describe("unread indicator predicates", () => {
  it("shows the true count while on and none while off", () => {
    expect(unreadCountShown(true, 7)).toBe(7);
    expect(unreadCountShown(false, 7)).toBe(0);
    expect(unreadCountShown(false, 0)).toBe(0);
  });

  it.each(["approval", "question", "done", "mention", "brief", "spend"] as const)("silences nothing while on: %s", (kind) => {
    expect(notifyKindSilencedByUnreadSwitch(true, kind)).toBe(false);
  });

  it.each(["done", "mention", "brief", "delegation-settled"] as const)("silences %s while off", (kind) => {
    expect(notifyKindSilencedByUnreadSwitch(false, kind)).toBe(true);
  });

  it.each(["approval", "question", "sign-in", "incident", "turn-failed", "routine-failed", "routine-deferred", "spend"] as const)("never silences %s", (kind) => {
    expect(notifyKindSilencedByUnreadSwitch(false, kind)).toBe(false);
  });
});
