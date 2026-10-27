import { beforeEach, describe, expect, it } from "vitest";
import { windowState } from "../testing/saved-steps-fixtures.ts";
import type { WireElement } from "./driver-wire.ts";
import type { RecipeStep } from "./rules.ts";
import { matchApp, matchElement, matchWindow, resolveStep, type CallOutcome, type ComputerCaller } from "./resolve.ts";

const TEXTEDIT = { bundleId: "com.apple.TextEdit", name: "TextEdit" };
const DOCUMENT = { role: "AXTextArea", label: "Document", path: ["AXScrollArea:"] };
const SAVE = { role: "AXButton", label: "Save", path: [] };
const CLICK_DOCUMENT: RecipeStep = { tool: "click", args: {}, app: TEXTEDIT, window: { title: "Untitled" }, element: DOCUMENT };
const CLICK_SAVE: RecipeStep = { ...CLICK_DOCUMENT, element: SAVE };

const TEXTEDIT_APP = { pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true };
const NOTES_INSTALLED = { pid: 0, name: "Notes", bundle_id: "com.apple.Notes", running: false };
const UNTITLED = { window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" };
const signal = new AbortController().signal;

const ok = (structured: object): CallOutcome => ({ ok: true, structured: structured as Record<string, unknown> });
const apps = (...list: object[]) => ok({ apps: list });
const windows = (...list: object[]) => ok({ windows: list });

const ELEMENTS: WireElement[] = windowState(2).elements ?? [];
const state = (elements: WireElement[] = ELEMENTS, extra: object = {}) => ({ ...windowState(2), elements, ...extra });
const renamed = state(ELEMENTS.map((element) => (element.label === "Document" ? { ...element, label: "Body" } : element)));
const untokened = state(ELEMENTS.map(({ element_token: _token, ...element }) => element));
const SECOND_SAVE: WireElement = { element_index: 4, element_token: "s2-e4", role: "AXButton", label: "Save", parent_index: 0, depth: 1 };

type Lookup = "list_apps" | "list_windows" | "get_window_state";
let calls: [string, Record<string, unknown>][] = [];
beforeEach(() => {
  calls = [];
});

function caller(windowStateAnswer: object, answers: Partial<Record<Lookup, CallOutcome>> = {}): ComputerCaller {
  const replies: Record<string, CallOutcome> = {
    list_apps: apps(TEXTEDIT_APP, NOTES_INSTALLED), list_windows: windows(UNTITLED), get_window_state: ok(windowStateAnswer), ...answers,
  };
  return {
    async call(tool, args) {
      calls.push([tool, args]);
      const reply = replies[tool];
      if (!reply) throw new Error(`unexpected ${tool}`);
      return reply;
    },
  };
}

const LOOKUPS: [string, Record<string, unknown>][] = [
  ["list_apps", {}], ["list_windows", { pid: 4242 }], ["get_window_state", { pid: 4242, window_id: 7, include_screenshot: false }],
];

describe("resolveStep", () => {
  it("resolves an element step afresh, without a screenshot", async () => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(windowState(2)), signal)).toEqual({ ok: true, args: { pid: 4242, window_id: 7, element_token: "s2-e2" } });
    expect(calls.at(-1)).toStrictEqual(["get_window_state", { pid: 4242, window_id: 7, include_screenshot: false }]);
    expect(calls).toEqual(LOOKUPS);
  });

  it("addresses by index when the snapshot has no tokens", async () => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(untokened), signal)).toStrictEqual({ ok: true, args: { pid: 4242, window_id: 7, element_index: 2 } });
  });

  it("keeps the saved arguments beside the fresh target", async () => {
    const step: RecipeStep = { ...CLICK_DOCUMENT, tool: "type_text", args: { text: "hello world" } };
    expect(await resolveStep(step, caller(windowState(3)), signal)).toEqual({ ok: true, args: { text: "hello world", pid: 4242, window_id: 7, element_token: "s3-e2" } });
  });

  it.each<[string, object]>([
    ["marked truncated", { truncated: true }],
    ["marked incomplete", { elements_complete: false }],
    ["given a truncation reason", { truncation_reason: "max_elements" }],
    ["counting more elements than it returned", { element_count: 5 }],
    ["counting more in the whole tree", { total_element_count: 900 }],
    ["counting more returned than it sent", { returned_element_count: 5 }],
    ["counting more after filtering", { filtered_element_count: 5 }],
    ["with an unreadable count", { element_count: "4" }],
  ])("refuses a tree the driver cut short: %s", async (_case, extra) => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(state(ELEMENTS, extra)), signal)).toEqual({ ok: false, error: "only part of Untitled could be read" });
  });

  it.each<[string, object]>([
    ["marked degraded", { degraded: true }],
    ["with a degraded reason", { degraded_reason: "AX messaging timed out" }],
  ])("refuses a degraded tree: %s", async (_case, extra) => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(state(ELEMENTS, extra)), signal)).toEqual({ ok: false, error: "Untitled could not be read reliably" });
  });

  it("accepts a tree whose counts match what was returned", async () => {
    const whole = state(ELEMENTS, {
      element_count: 4, total_element_count: 4, returned_element_count: 4, filtered_element_count: 4,
      elements_complete: true, truncated: false, degraded: false, degraded_reason: null, truncation_reason: null,
    });
    expect(await resolveStep(CLICK_DOCUMENT, caller(whole), signal)).toEqual({ ok: true, args: { pid: 4242, window_id: 7, element_token: "s2-e2" } });
  });

  it("fails a renamed element with words a person can read", async () => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(renamed), signal)).toEqual({ ok: false, error: 'no "Document" (AXTextArea) in Untitled' });
  });

  it("fails on two elements with the same role, label and path", async () => {
    expect(await resolveStep(CLICK_SAVE, caller(state([...ELEMENTS, SECOND_SAVE])), signal))
      .toEqual({ ok: false, error: 'more than one "Save" (AXButton) in Untitled' });
  });

  it("resolves inside the only window after it was renamed", async () => {
    const renamedWindow = { ...UNTITLED, window_id: 9, title: "Untitled 2" };
    const inside = state(ELEMENTS.map((element) => (element.role === "AXWindow" ? { ...element, label: "Untitled 2" } : element)), { window_id: 9, window_title: "Untitled 2" });
    expect(await resolveStep(CLICK_DOCUMENT, caller(inside, { list_windows: windows(renamedWindow) }), signal))
      .toEqual({ ok: true, args: { pid: 4242, window_id: 9, element_token: "s2-e2" } });
    expect(calls.at(-1)).toEqual(["get_window_state", { pid: 4242, window_id: 9, include_screenshot: false }]);
  });

  it("fails without looking inside when two windows are open and none has the saved title", async () => {
    const two = windows({ ...UNTITLED, window_id: 8, title: "A" }, { ...UNTITLED, window_id: 9, title: "B" });
    expect(await resolveStep(CLICK_DOCUMENT, caller(windowState(2), { list_windows: two }), signal)).toEqual({ ok: false, error: "more than one window of TextEdit" });
    expect(calls.map(([tool]) => tool)).toEqual(["list_apps", "list_windows"]);
  });

  it("fails when the app has no window with the saved title or any other", async () => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(windowState(2), { list_windows: windows() }), signal)).toEqual({ ok: false, error: 'no window titled "Untitled"' });
  });

  it.each<[string, CallOutcome]>([
    ["the app has quit", apps(NOTES_INSTALLED)],
    ["list_apps lists the app as not running", apps({ ...TEXTEDIT_APP, running: false })],
    ["list_apps lists the app without a process", apps({ ...TEXTEDIT_APP, pid: 0 })],
  ])("fails when %s", async (_case, listed) => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(windowState(2), { list_apps: listed }), signal)).toEqual({ ok: false, error: "TextEdit is not running" });
    expect(calls.map(([tool]) => tool)).toEqual(["list_apps"]);
  });

  it("fails when two copies of the app are running", async () => {
    const twice = apps(TEXTEDIT_APP, { ...TEXTEDIT_APP, pid: 4343 });
    expect(await resolveStep(CLICK_DOCUMENT, caller(windowState(2), { list_apps: twice }), signal)).toEqual({ ok: false, error: "more than one TextEdit app is running" });
  });

  it.each<[Lookup, number]>([["list_apps", 1], ["list_windows", 2], ["get_window_state", 3]])("passes a %s failure through", async (tool, made) => {
    expect(await resolveStep(CLICK_DOCUMENT, caller(windowState(2), { [tool]: { ok: false, error: "boom" } }), signal)).toEqual({ ok: false, error: "boom" });
    expect(calls).toEqual(LOOKUPS.slice(0, made));
  });

  it("needs no lookups for launch_app", async () => {
    const step: RecipeStep = { tool: "launch_app", args: { name: "TextEdit" } };
    expect(await resolveStep(step, caller(windowState(2)), signal)).toEqual({ ok: true, args: { name: "TextEdit" } });
    expect(calls).toEqual([]);
  });

  it("targets bring_to_front and an app's hotkey at a fresh pid and window", async () => {
    const front: RecipeStep = { tool: "bring_to_front", args: {}, app: TEXTEDIT, window: { title: "Untitled" } };
    expect(await resolveStep(front, caller(windowState(2)), signal)).toEqual({ ok: true, args: { pid: 4242, window_id: 7 } });
    expect(calls).toEqual(LOOKUPS.slice(0, 2));
    calls = [];
    const save: RecipeStep = { tool: "hotkey", args: { keys: ["cmd", "s"] }, app: TEXTEDIT };
    expect(await resolveStep(save, caller(windowState(2)), signal)).toStrictEqual({ ok: true, args: { keys: ["cmd", "s"], pid: 4242 } });
    expect(calls).toEqual(LOOKUPS.slice(0, 1));
  });

  it("sends a hotkey saved without an app as it was recorded", async () => {
    const step: RecipeStep = { tool: "press_key", args: { key: "return" } };
    expect(await resolveStep(step, caller(windowState(2)), signal)).toStrictEqual({ ok: true, args: { key: "return" } });
    expect(calls).toEqual([]);
  });

  it.each<[string, RecipeStep]>([
    ["a window", { tool: "hotkey", args: { keys: ["cmd", "s"] }, window: { title: "Untitled" } }],
    ["an element", { tool: "click", args: {}, window: { title: "Untitled" }, element: DOCUMENT }],
  ])("refuses %s target saved without its app", async (_case, step) => {
    expect(await resolveStep(step, caller(windowState(2)), signal)).toEqual({ ok: false, error: "the saved step does not name its app" });
    expect(calls).toEqual([]);
  });

  it("finds an element saved without a window in the app's only window, and names the app when it is gone", async () => {
    const { window: _window, ...noWindow } = CLICK_DOCUMENT;
    expect(await resolveStep(noWindow, caller(windowState(2)), signal)).toEqual({ ok: true, args: { pid: 4242, window_id: 7, element_token: "s2-e2" } });
    expect(await resolveStep(noWindow, caller(renamed), signal)).toEqual({ ok: false, error: 'no "Document" (AXTextArea) in TextEdit' });
  });
});

describe("matchApp", () => {
  it("prefers bundle id over name", () => expect(matchApp([{ pid: 1, name: "Notes", bundle_id: "a" }, { pid: 2, name: "Notes", bundle_id: "b" }], { bundleId: "b", name: "Notes" })).toEqual({ ok: true, value: 2 }));

  it("never falls back to the name when a bundle id is saved", () =>
    expect(matchApp([{ pid: 1, name: "Notes", bundle_id: "a" }], { bundleId: "b", name: "Notes" })).toEqual({ ok: false, reason: "none" }));

  it("matches the exact name when no bundle id is saved", () =>
    expect(matchApp([{ pid: 1, name: "notes" }, { pid: 2, name: "Notes" }], { name: "Notes" })).toEqual({ ok: true, value: 2 }));

  it("never picks an app that is not running", () => {
    expect(matchApp([{ pid: 0, name: "TextEdit", running: false }], { name: "TextEdit" })).toEqual({ ok: false, reason: "none" });
    expect(matchApp([{ pid: 4242, name: "TextEdit", running: false }], { name: "TextEdit" })).toEqual({ ok: false, reason: "none" });
  });

  it("refuses an identity with neither bundle id nor name", () => {
    expect(matchApp([{ pid: 1, name: "Notes" }], {})).toEqual({ ok: false, reason: "none" });
    expect(matchApp([{ pid: 1, name: "" }], { bundleId: "", name: "" })).toEqual({ ok: false, reason: "none" });
  });

  it("calls two running copies ambiguous", () =>
    expect(matchApp([{ pid: 1, name: "Notes" }, { pid: 2, name: "Notes" }], { name: "Notes" })).toEqual({ ok: false, reason: "ambiguous" }));

  it.each<[string, unknown]>([
    ["not a list", { pid: 1, name: "Notes" }],
    ["a string pid", [{ pid: "1", name: "Notes" }]],
    ["one unreadable entry beside a match", [{ pid: 1, name: "Notes" }, { pid: 2, name: "Notes", bundle_id: 7 }]],
  ])("reads nothing from %s", (_case, list) => expect(matchApp(list, { name: "Notes" })).toEqual({ ok: false, reason: "none" }));
});

describe("matchWindow", () => {
  it("takes the only window when the title changed", () => expect(matchWindow([{ window_id: 9, pid: 4242, title: "Untitled 2" }], 4242, { title: "Untitled" })).toEqual({ ok: true, value: 9 }));

  it("refuses two windows when none has the title", () => expect(matchWindow([{ window_id: 8, pid: 4242, title: "A" }, { window_id: 9, pid: 4242, title: "B" }], 4242, { title: "Untitled" })).toEqual({ ok: false, reason: "ambiguous" }));

  it("takes the one window with the exact title among several", () =>
    expect(matchWindow([{ window_id: 8, pid: 4242, title: "untitled" }, { window_id: 9, pid: 4242, title: "Untitled" }], 4242, { title: "Untitled" })).toEqual({ ok: true, value: 9 }));

  it("refuses two windows with the saved title", () =>
    expect(matchWindow([{ window_id: 8, pid: 4242, title: "Untitled" }, { window_id: 9, pid: 4242, title: "Untitled" }], 4242, { title: "Untitled" })).toEqual({ ok: false, reason: "ambiguous" }));

  it("ignores other apps' windows", () =>
    expect(matchWindow([{ window_id: 9, pid: 1, title: "Untitled" }], 4242, { title: "Untitled" })).toEqual({ ok: false, reason: "none" }));

  it("takes the only window when none was saved, and no other", () => {
    expect(matchWindow([{ window_id: 9, pid: 4242, title: "A" }], 4242, undefined)).toEqual({ ok: true, value: 9 });
    expect(matchWindow([{ window_id: 8, pid: 4242, title: "A" }, { window_id: 9, pid: 4242, title: "B" }], 4242, undefined)).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("reads nothing from a list with an unreadable entry", () =>
    expect(matchWindow([{ window_id: 9, pid: 4242, title: "Untitled" }, { window_id: 8, title: "B" }], 4242, { title: "Untitled" })).toEqual({ ok: false, reason: "none" }));
});

describe("matchElement", () => {
  it("finds the element with the same role, label and path", () => expect(matchElement(ELEMENTS, DOCUMENT)).toEqual({ ok: true, value: ELEMENTS[2] }));

  it("refuses duplicate labels on the same path", () => expect(matchElement([...ELEMENTS, SECOND_SAVE], SAVE)).toEqual({ ok: false, reason: "ambiguous" }));

  it("tells the same label apart by path and role", () => {
    const deeper: WireElement = { ...SECOND_SAVE, parent_index: 1, depth: 2 };
    expect(matchElement([...ELEMENTS, deeper], SAVE)).toEqual({ ok: true, value: ELEMENTS[3] });
    expect(matchElement([...ELEMENTS, deeper], { ...SAVE, path: ["AXScrollArea:"] })).toEqual({ ok: true, value: deeper });
    expect(matchElement(ELEMENTS, { ...SAVE, role: "AXStaticText" })).toEqual({ ok: false, reason: "none" });
  });

  it("counts a look-alike whose ancestry cannot be read as a second match", () =>
    expect(matchElement([...ELEMENTS, { ...SECOND_SAVE, parent_index: 99 }], SAVE)).toEqual({ ok: false, reason: "ambiguous" }));

  it.each<[string, unknown]>([
    ["not a list", undefined],
    ["one unreadable entry beside a match", [...ELEMENTS, { element_index: 5, role: "AXButton", label: 3, depth: 1 }]],
  ])("reads nothing from %s", (_case, list) => expect(matchElement(list, DOCUMENT)).toEqual({ ok: false, reason: "none" }));
});
