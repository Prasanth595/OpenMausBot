// The Workshop panel's testable core. The drawing math lives in
// src/lib/workshop-canvas.ts (its own suite); what is proven here is the
// panel's judgment layer: which crate files may become a preview URL, the
// prompt the sketch rides in, and the live-turn line rendering.
import { afterEach, describe, expect, it } from "vitest";

import { figurePreviewUrl, LiveLine, promptForSketch } from "./WorkshopPanel";
import { setLocale, t } from "@/lib/i18n";
import type { Message } from "@/state/store";

afterEach(() => setLocale("en"));

function message(overrides: Partial<Message> = {}): Message {
  return { id: "m1", role: "bot", kind: "text", text: "hello", ...overrides } as Message;
}

describe("figure preview urls", () => {
  it("only trusts bare crate names", () => {
    expect(figurePreviewUrl("figure-pump-turbine.svg")).toBe(
      `/api/workshop/files/${encodeURIComponent("figure-pump-turbine.svg")}`,
    );
    expect(figurePreviewUrl("probe.md")).toBeNull();
    expect(figurePreviewUrl("probe.json")).toBeNull();
  });

  it("refuses hostile and remote-shaped names", () => {
    expect(figurePreviewUrl("../escape.md")).toBeNull();
    expect(figurePreviewUrl(".hidden.svg")).toBeNull();
    expect(figurePreviewUrl(".hidden.svg.length>1.svg")).toBeNull();
    expect(figurePreviewUrl("https://example.com/figure.svg")).toBeNull();
    expect(figurePreviewUrl("figure-pump.svg extra")).toBeNull();
  });

  it("accepts names up to the crate's 64-char limit", () => {
    const longest = `figure-${"a".repeat(53)}.svg`; // exactly 64 chars
    expect(longest.length).toBe(64);
    expect(figurePreviewUrl(longest)).toBeTruthy();
    expect(figurePreviewUrl(`${longest}x`)).toBeNull();
  });
});

describe("the sketch prompt", () => {
  it("carries the trigger terms the anatomy skill mounts by", () => {
    const prompt = promptForSketch("The arrows are coolant flow.");
    expect(prompt).toContain("isometric");
    expect(prompt).toContain("workshop figure");
    expect(prompt).toContain("The arrows are coolant flow.");
  });

  it("stays one paragraph when there is no note", () => {
    expect(promptForSketch("   ")).toBe(promptForSketch(""));
    expect(promptForSketch("")).not.toContain("\n\n");
  });
});

describe("live turn lines", () => {
  it("styles bot and user lines differently", () => {
    const bot = LiveLine({ message: message() });
    expect(JSON.stringify(bot)).toContain("bg-raised");
    const user = LiveLine({ message: message({ role: "user" }) });
    expect(JSON.stringify(user)).toContain("bg-accent/10");
  });

  it("truncates runaway tool chatter", () => {
    const line = LiveLine({ message: message({ text: "x".repeat(900) }) });
    // the visible copy is exactly the first 600 characters
    expect(line?.props.children.props.children).toBe("x".repeat(600));
  });
});

describe("locale keys", () => {
  it("resolves every string the panel asks its catalog for", () => {
    const keys: Array<Parameters<typeof t>[0]> = [
      "workshop.title",
      "workshop.subtitle",
      "workshop.close",
      "workshop.gate.title",
      "workshop.gate.body",
      "workshop.gate.enable",
      "workshop.tool.pen",
      "workshop.tool.eraser",
      "workshop.pin.undo",
      "workshop.pin.redo",
      "workshop.pin.clear",
      "workshop.pin.labelHint",
      "workshop.bot.noteLabel",
      "workshop.bot.notePlaceholder",
      "workshop.bot.send",
      "workshop.bot.noneSelected",
      "workshop.bot.noBots",
      "workshop.bot.working",
      "workshop.live.title",
      "workshop.live.idle",
      "workshop.live.openChat",
      "workshop.figures.title",
      "workshop.figures.empty",
      "workshop.figures.refresh",
      "workshop.figures.remove",
      "workshop.figures.open",
      "workshop.error.export",
      "workshop.error.upload",
      "workshop.error.send",
      "workshop.error.list",
      "sidebar.nav.workshop",
    ];
    for (const key of keys) {
      expect(t(key)).not.toBe(key);
    }
  });
});
