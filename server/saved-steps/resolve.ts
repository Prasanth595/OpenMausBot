import { elementPath, type WireElement } from "./driver-wire.ts";
import type { AppIdentity, ElementIdentity, RecipeStep } from "./rules.ts";

export type CallOutcome = { ok: true; structured: Record<string, unknown> } | { ok: false; error: string };
export interface ComputerCaller { call(tool: string, args: Record<string, unknown>, signal: AbortSignal): Promise<CallOutcome> }
export type Match<T> = { ok: true; value: T } | { ok: false; reason: "none" | "ambiguous" };
type Resolved = { ok: true; args: Record<string, unknown> } | { ok: false; error: string };

type Kind = "string" | "number" | "boolean";
interface Shape { required: Record<string, Kind>; optional: Record<string, Kind> }
interface LiveApp { pid: number; name: string; bundle_id?: string; running?: boolean }
interface LiveWindow { window_id: number; pid: number; title: string }

const APP: Shape = { required: { pid: "number", name: "string" }, optional: { bundle_id: "string", running: "boolean" } };
const WINDOW: Shape = { required: { window_id: "number", pid: "number", title: "string" }, optional: {} };
const ELEMENT: Shape = {
  required: { element_index: "number", role: "string", depth: "number" },
  optional: { element_token: "string", label: "string", parent_index: "number" },
};

const NONE = { ok: false, reason: "none" } as const;
const AMBIGUOUS = { ok: false, reason: "ambiguous" } as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function readEntry<T>(item: unknown, shape: Shape): T | null {
  if (!isRecord(item)) return null;
  const entry: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(shape.required)) {
    if (typeof item[key] !== kind) return null;
    entry[key] = item[key];
  }
  for (const [key, kind] of Object.entries(shape.optional)) {
    const value = item[key];
    if (value === undefined || value === null) continue;
    if (typeof value !== kind) return null;
    entry[key] = value;
  }
  return entry as T;
}

// Safety invariant: one unreadable entry makes the whole list unreadable. Skipping it could hide
// the second match that makes a target ambiguous.
function readList<T>(value: unknown, shape: Shape): T[] | null {
  if (!Array.isArray(value)) return null;
  const entries: T[] = [];
  for (const item of value) {
    const entry = readEntry<T>(item, shape);
    if (entry === null) return null;
    entries.push(entry);
  }
  return entries;
}

function only<T>(candidates: readonly T[]): Match<T> {
  const [first, ...rest] = candidates;
  if (first === undefined) return NONE;
  return rest.length ? AMBIGUOUS : { ok: true, value: first };
}

export function matchApp(apps: unknown, app: AppIdentity): Match<number> {
  const list = readList<LiveApp>(apps, APP);
  const sameApp = app.bundleId ? (live: LiveApp) => live.bundle_id === app.bundleId : app.name ? (live: LiveApp) => live.name === app.name : null;
  if (!list || !sameApp) return NONE;
  return only(list.filter((live) => live.pid > 0 && live.running !== false && sameApp(live)).map((live) => live.pid));
}

export function matchWindow(windows: unknown, pid: number, window: { title: string } | undefined): Match<number> {
  const list = readList<LiveWindow>(windows, WINDOW);
  if (!list) return NONE;
  const own = list.filter((live) => live.pid === pid);
  const titled = window ? own.filter((live) => live.title === window.title) : [];
  return only((titled.length ? titled : own).map((live) => live.window_id));
}

const samePath = (path: readonly string[], saved: readonly string[]) => path.length === saved.length && path.every((part, index) => part === saved[index]);

export function matchElement(elements: unknown, element: ElementIdentity): Match<WireElement> {
  const list = readList<WireElement>(elements, ELEMENT);
  if (!list) return NONE;
  const candidates = list
    .filter((live) => live.role === element.role && live.label === element.label)
    .map((live) => ({ live, path: elementPath(list, live) }))
    .filter(({ path }) => path === null || samePath(path, element.path));
  const match = only(candidates);
  if (!match.ok) return match;
  return match.value.path === null ? NONE : { ok: true, value: match.value.live };
}

const appName = (app: AppIdentity) => app.name || app.bundleId || "the app";
const fail = (error: string): Resolved => ({ ok: false, error });

export async function resolveStep(step: RecipeStep, caller: ComputerCaller, signal: AbortSignal): Promise<Resolved> {
  if (step.tool === "launch_app") return { ok: true, args: step.args };
  if (!step.app) return step.window || step.element ? fail("the saved step does not name its app") : { ok: true, args: step.args };
  const name = appName(step.app);

  const apps = await caller.call("list_apps", {}, signal);
  if (!apps.ok) return apps;
  const pid = matchApp(apps.structured.apps, step.app);
  if (!pid.ok) return fail(pid.reason === "none" ? `${name} is not running` : `more than one ${name} app is running`);
  const args: Record<string, unknown> = { ...step.args, pid: pid.value };
  if (!step.window && !step.element) return { ok: true, args };

  const windows = await caller.call("list_windows", { pid: pid.value }, signal);
  if (!windows.ok) return windows;
  const windowId = matchWindow(windows.structured.windows, pid.value, step.window);
  if (!windowId.ok) {
    if (windowId.reason === "ambiguous") return fail(`more than one window of ${name}`);
    return fail(step.window ? `no window titled "${step.window.title}"` : `${name} has no open window`);
  }
  args.window_id = windowId.value;
  if (!step.element) return { ok: true, args };

  const state = await caller.call("get_window_state", { pid: pid.value, window_id: windowId.value, include_screenshot: false }, signal);
  if (!state.ok) return state;
  const found = matchElement(state.structured.elements, step.element);
  if (!found.ok) {
    const target = `"${step.element.label}" (${step.element.role}) in ${step.window?.title ?? name}`;
    return fail(found.reason === "none" ? `no ${target}` : `more than one ${target}`);
  }
  const { element_token: token, element_index: index } = found.value;
  return { ok: true, args: token === undefined ? { ...args, element_index: index } : { ...args, element_token: token } };
}
