import type { SlimStructured, WireElement } from "../saved-steps/driver-wire.ts";
import type { RecordedCall, RequestJournal } from "../saved-steps/journal.ts";

export function windowState(snapshot: number): SlimStructured {
  const token = (index: number) => `s${snapshot}-e${index}`;
  const elements: WireElement[] = [
    { element_index: 0, element_token: token(0), role: "AXWindow", label: "Untitled", depth: 0 },
    { element_index: 1, element_token: token(1), role: "AXScrollArea", parent_index: 0, depth: 1 },
    { element_index: 2, element_token: token(2), role: "AXTextArea", label: "Document", parent_index: 1, depth: 2 },
    { element_index: 3, element_token: token(3), role: "AXButton", label: "Save", parent_index: 0, depth: 1 },
  ];
  return { pid: 4242, app_name: "TextEdit", bundle_id: "com.apple.TextEdit", window_id: 7, window_title: "Untitled", elements };
}

export function completeWindowState(structured: SlimStructured): Record<string, unknown> {
  const count = structured.elements?.length ?? 0;
  return { ...structured, elements_complete: true, element_count: count, returned_element_count: count, total_element_count: count };
}

const ok = (structured?: SlimStructured) => ({ isError: false, ...(structured ? { structured } : {}) });

export function textEditJournal(overrides: { calls?: RecordedCall[]; complete?: boolean; tainted?: boolean } = {}): RequestJournal {
  const calls: RecordedCall[] = overrides.calls ?? [
    { tool: "list_apps", arguments: {}, result: ok({ apps: [{ pid: 4242, name: "TextEdit", bundle_id: "com.apple.TextEdit", running: true }] }), generation: "g1" },
    { tool: "list_windows", arguments: { pid: 4242 }, result: ok({ windows: [{ window_id: 7, pid: 4242, title: "Untitled", app_name: "TextEdit" }] }), generation: "g1" },
    { tool: "get_window_state", arguments: { pid: 4242, window_id: 7 }, result: ok(windowState(1)), generation: "g1" },
    { tool: "click", arguments: { element_token: "s1-e2" }, result: ok(), generation: "g1" },
    { tool: "type_text", arguments: { element_token: "s1-e2", text: "hello world" }, result: ok(), generation: "g1" },
  ];
  return { calls, complete: overrides.complete ?? true, tainted: overrides.tainted ?? false };
}
