import { describe, expect, it } from "vitest";

import { linkedChatOf } from "./wire.ts";

describe("linkedChatOf", () => {
  it("keeps t3-thread and https links, trims the label, and clears on null", () => {
    expect(linkedChatOf({ label: " WongCode chat ", url: "t3-thread://v1/abc" })).toEqual({
      label: "WongCode chat",
      url: "t3-thread://v1/abc",
    });
    expect(linkedChatOf({ label: "Doc", url: "https://example.com/x" })).toEqual({ label: "Doc", url: "https://example.com/x" });
    expect(linkedChatOf(null)).toBeNull();
  });
  it("refuses script, http, file and odd shapes", () => {
    for (const url of ["javascript:alert(1)", "http://x", "file:///etc/passwd", "t3-thread://", ""]) {
      expect(typeof linkedChatOf({ label: "x", url })).toBe("string");
    }
    expect(typeof linkedChatOf({ label: "", url: "https://x" })).toBe("string");
    expect(typeof linkedChatOf("https://x")).toBe("string");
  });
});
