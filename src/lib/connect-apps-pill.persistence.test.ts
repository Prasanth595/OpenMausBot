// @vitest-environment happy-dom
// The dismissal has to survive a real restart, not just the module-level flag a previous test left behind. Resetting
// the module registry clears that flag while keeping localStorage, which is exactly what a new app process sees.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONNECT_APPS_PILL_KEY } from "@/lib/connect-apps-pill";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => { values.set(key, String(value)); },
  };
}

const storage = memoryStorage();

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: storage });
  window.localStorage.clear();
  vi.resetModules();
});

describe("a dismissed Connect apps pill survives without the session flag", () => {
  it("reads a saved dismissal from localStorage in a module that never saw the click", async () => {
    window.localStorage.setItem(CONNECT_APPS_PILL_KEY, "1");
    const fresh = await import("@/lib/connect-apps-pill");
    expect(fresh.connectAppsPillDismissed()).toBe(true);
  });

  it("writes the dismissal to localStorage, so a fresh module still reports it", async () => {
    const before = await import("@/lib/connect-apps-pill");
    before.dismissConnectAppsPill();
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBe("1");

    vi.resetModules();
    const after = await import("@/lib/connect-apps-pill");
    expect(after.connectAppsPillDismissed()).toBe(true);

    after.restoreConnectAppsPill();
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBeNull();
    vi.resetModules();
    const restored = await import("@/lib/connect-apps-pill");
    expect(restored.connectAppsPillDismissed()).toBe(false);
  });

  it("does not treat an unrelated key as a dismissal", async () => {
    window.localStorage.setItem("omb-advanced-mode", "0");
    const fresh = await import("@/lib/connect-apps-pill");
    expect(fresh.connectAppsPillDismissed()).toBe(false);
  });
});
