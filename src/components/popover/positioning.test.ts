import { describe, expect, it } from "vitest";
import {
  nextMenuIndex,
  pointPopoverPosition,
  submenuPosition,
  transformOriginForPlacement,
  triggerPopoverPosition,
} from "./positioning";

const viewport = { width: 1280, height: 800 };
const menu = { width: 280, height: 300 };
// the profile row of a 300px sidebar, at the bottom of the window
const wideRow = { left: 12, right: 288, top: 740, bottom: 784 };

describe("triggerPopoverPosition", () => {
  it("auto prefers above on the trigger's start edge", () => {
    expect(triggerPopoverPosition(wideRow, menu, viewport)).toEqual({
      left: 12,
      top: 740 - 6 - 300,
      resolved: "above",
    });
  });

  it("anchors to the right edge in RTL and stays inside the window", () => {
    const rtlRow = { left: 980, right: 1268, top: 740, bottom: 784 };
    expect(triggerPopoverPosition(rtlRow, menu, viewport, { rtl: true })).toEqual({
      left: 1268 - 280,
      top: 434,
      resolved: "above",
    });
  });

  it("drops below when there is no room above and clamps to a short window", () => {
    expect(
      triggerPopoverPosition({ left: 12, right: 60, top: 40, bottom: 80 }, menu, viewport).resolved,
    ).toBe("below");
    expect(
      triggerPopoverPosition({ left: 12, right: 60, top: 100, bottom: 140 }, menu, { width: 800, height: 320 }).top,
    ).toBe(12);
  });

  it("centers and end-aligns on request", () => {
    const anchor = { left: 400, right: 440, top: 740, bottom: 784 };
    expect(triggerPopoverPosition(anchor, menu, viewport, { align: "center" }).left).toBe(420 - 140);
    expect(triggerPopoverPosition(anchor, menu, viewport, { align: "end" }).left).toBe(440 - 280);
  });
});

describe("pointPopoverPosition", () => {
  it("opens below-end of the point", () => {
    expect(pointPopoverPosition({ x: 100, y: 100 }, menu, viewport)).toEqual({
      left: 106,
      top: 106,
      resolved: "below",
    });
  });

  it("flips up and over near the bottom-right corner", () => {
    const placed = pointPopoverPosition({ x: 1200, y: 750 }, menu, viewport);
    expect(placed.top).toBe(750 - 6 - 300);
    expect(placed.left).toBe(1200 - 6 - 280);
    expect(placed.resolved).toBe("above");
  });

  it("clamps negative anchors inside the window", () => {
    expect(pointPopoverPosition({ x: -20, y: -10 }, menu, viewport)).toEqual({
      left: 8,
      top: 8,
      resolved: "below",
    });
  });
});

describe("submenuPosition", () => {
  const sheet = { left: 12, right: 292, top: 434, bottom: 734 };
  const row = { left: 18, right: 286, top: 520, bottom: 560 };
  const sub = { width: 240, height: 180 };

  it("sits beside the menu on the inline end side, level with its row", () => {
    expect(submenuPosition(sheet, row, sub, viewport)).toEqual({ left: 296, top: 514 });
  });

  it("flips to the other side when the window has no room", () => {
    const right = { left: 900, right: 1180, top: 434, bottom: 734 };
    expect(submenuPosition(right, row, sub, viewport).left).toBe(900 - 4 - 240);
  });
});

describe("nextMenuIndex", () => {
  it("moves through items with arrows, Home and End, wrapping", () => {
    expect(nextMenuIndex("ArrowDown", -1, 4)).toBe(0);
    expect(nextMenuIndex("ArrowDown", 3, 4)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 0, 4)).toBe(3);
    expect(nextMenuIndex("Home", 2, 4)).toBe(0);
    expect(nextMenuIndex("End", 0, 4)).toBe(3);
    expect(nextMenuIndex("a", 0, 4)).toBeNull();
  });
});

describe("transformOriginForPlacement", () => {
  it("grows out of the anchor edge", () => {
    expect(transformOriginForPlacement("above")).toBe("bottom left");
    expect(transformOriginForPlacement("below", true)).toBe("top right");
    expect(transformOriginForPlacement("before")).toBe("right center");
    expect(transformOriginForPlacement("after", true)).toBe("right center");
  });
});
