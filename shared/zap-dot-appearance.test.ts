import { describe, expect, it } from "vitest";
import { MASCOT_BODY_IDS } from "./mascot-bodies";
import { ZAP_DOT_COLORS, zapDotShape } from "./zap-dot-appearance";

describe("Zap dot identity rendering", () => {
  it("keeps every persisted body ID valid and projects it onto a Zap shape", () => {
    expect(MASCOT_BODY_IDS.map(zapDotShape)).toEqual([
      "circle", "squircle", "circle", "squircle", "pill", "circle", "squircle", "hexagon", "hexagon", "hexagon",
    ]);
    expect(zapDotShape("unknown-body")).toBe("circle");
    expect(zapDotShape(null)).toBe("circle");
  });

  it("uses the reference palette consistently without deriving hue from a name or seed", () => {
    expect([ZAP_DOT_COLORS.green, ZAP_DOT_COLORS.pink, ZAP_DOT_COLORS.blue, ZAP_DOT_COLORS.purple, ZAP_DOT_COLORS.orange])
      .toEqual(["#C8FF00", "#FF5FCB", "#4DA3FF", "#B98CFF", "#FFB020"]);
    expect(new Set(Object.values(ZAP_DOT_COLORS)).size).toBe(10);
  });
});
