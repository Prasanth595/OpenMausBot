import { describe, expect, it } from "vitest";
import { dockBadgeCount, notifyKindSilencedByUnreadSwitch, unreadCountShown } from "./unread-indicators";

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

  it("clamps a negative or non-finite count to zero", () => {
    for (const bad of [-3, Number.NaN, Number.POSITIVE_INFINITY]) expect(unreadCountShown(true, bad)).toBe(0);
  });

  it("dock badge counts visible unread bots and rooms, and is 0 whatever the count while off", () => {
    const bots = [{ unread: true }, { unread: true, hidden: true }, { unread: false }];
    const groups = [{ unread: true }, { unread: false }];
    expect(dockBadgeCount(true, bots, groups)).toBe(2);
    expect(dockBadgeCount(false, bots, groups)).toBe(0);
    expect(dockBadgeCount(true, [], [])).toBe(0);
  });
});
