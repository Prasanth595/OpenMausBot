import { useSyncExternalStore } from "react";

export type SidebarModelIcons = "show" | "hide";
export type UsageDisplay = "always" | "hide" | "never";

export const SIDEBAR_MODEL_ICONS: readonly SidebarModelIcons[] = ["show", "hide"];
export const USAGE_DISPLAYS: readonly UsageDisplay[] = ["always", "hide", "never"];

export const SIDEBAR_MODEL_ICONS_KEY = "openmausbot.sidebarModelIcons";
export const USAGE_DISPLAY_KEY = "openmausbot.usageDisplay";

export function parseSidebarModelIcons(value: string | null | undefined): SidebarModelIcons {
  return value === "hide" ? "hide" : "show";
}

export function parseUsageDisplay(value: string | null | undefined): UsageDisplay {
  return value === "hide" || value === "never" ? value : "always";
}

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function preference<T extends string>(key: string, parse: (value: string | null) => T) {
  let session: T | undefined;
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const read = (): T => {
    if (session !== undefined) return session;
    try {
      return parse(storage()?.getItem(key) ?? null);
    } catch {
      return parse(null);
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    if (event.storageArea && event.storageArea !== storage()) return;
    session = undefined;
    notify();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (listeners.size === 1 && typeof window !== "undefined") window.addEventListener("storage", onStorage);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("storage", onStorage);
    };
  };
  const set = (value: T) => {
    session = value;
    try {
      storage()?.setItem(key, value);
    } catch {
    }
    notify();
  };
  return { read, set, use: () => useSyncExternalStore(subscribe, read, read) };
}

const modelIcons = preference(SIDEBAR_MODEL_ICONS_KEY, parseSidebarModelIcons);
const usageDisplay = preference(USAGE_DISPLAY_KEY, parseUsageDisplay);

export const loadSidebarModelIcons = modelIcons.read;
export const setSidebarModelIcons = modelIcons.set;
export const useSidebarModelIcons = modelIcons.use;
export const loadUsageDisplay = usageDisplay.read;
export const setUsageDisplay = usageDisplay.set;
export const useUsageDisplay = usageDisplay.use;
