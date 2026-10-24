// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  loadSidebarModelIcons, loadUsageDisplay, parseSidebarModelIcons, parseUsageDisplay,
  setSidebarModelIcons, setUsageDisplay, SIDEBAR_MODEL_ICONS_KEY, USAGE_DISPLAY_KEY,
} from "./usage-display-preferences";

beforeEach(() => localStorage.clear());

describe("usage display preferences", () => {
  it("default to showing icons and the always-on strip", () => {
    setSidebarModelIcons(parseSidebarModelIcons(null));
    setUsageDisplay(parseUsageDisplay(null));
    expect(loadSidebarModelIcons()).toBe("show");
    expect(loadUsageDisplay()).toBe("always");
  });

  it("persist each choice independently", () => {
    setSidebarModelIcons("hide");
    expect(localStorage.getItem(SIDEBAR_MODEL_ICONS_KEY)).toBe("hide");
    expect(localStorage.getItem(USAGE_DISPLAY_KEY)).toBeNull();
    setUsageDisplay("never");
    expect(localStorage.getItem(USAGE_DISPLAY_KEY)).toBe("never");
    expect(loadSidebarModelIcons()).toBe("hide");
    setUsageDisplay("hide");
    expect(loadUsageDisplay()).toBe("hide");
    expect(loadSidebarModelIcons()).toBe("hide");
  });

  it("falls back to defaults for unknown stored values", () => {
    expect(parseSidebarModelIcons("bogus")).toBe("show");
    expect(parseUsageDisplay("bogus")).toBe("always");
    expect(parseUsageDisplay("never")).toBe("never");
  });
});
