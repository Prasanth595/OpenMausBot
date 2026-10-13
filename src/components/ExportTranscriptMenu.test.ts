// @vitest-environment happy-dom
// The room header's export menu is the shared PopoverMenu now: a real click
// opens the sheet (portaled to the body, beside the test's own host), the
// heading names it and the rows are the ones a person reads.
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { ExportTranscriptMenu } from "./ExportTranscriptMenu";

/** A minimal bot reply message for export-menu tests. */
const reply = (): Message => ({ id: "m1", role: "bot", kind: "text", text: "Hello", at: 1 });

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  document.documentElement.dataset.reducedMotion = "true";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  delete document.documentElement.dataset.reducedMotion;
});

/** The export-menu trigger button in the test host. */
const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label="Export conversation"]')!;
/** Text of every row in the open export sheet. */
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].map((row) => row.textContent ?? "");
/** The open popover sheet element. */
const sheet = () => document.querySelector<HTMLElement>("[data-popover]")!;
/** Mounts the export menu and opens it with a real click. */
const open = async (messages: Message[]) => {
  act(() => { root.render(createElement(ExportTranscriptMenu, { title: "Launch", messages })); });
  await act(async () => trigger().click());
};

describe("the room header's export menu", () => {
  it("offers copying and downloading under its own heading", async () => {
    await open([reply()]);
    expect(rows()).toEqual(["Copy as Markdown", "Download as .md"]);
    expect(sheet().getAttribute("aria-label")).toBe("Export conversation");
    expect(sheet().textContent).toContain("Export Conversation");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
  });

  it("says there is nothing to export yet", async () => {
    await open([]);
    expect(rows()).toEqual([]);
    expect(sheet().textContent).toContain("No messages to export yet.");
  });

  it("closes again on the trigger", async () => {
    await open([reply()]);
    expect(rows()).toHaveLength(2);
    await act(async () => trigger().click());
    expect(rows()).toHaveLength(0);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
  });
});
