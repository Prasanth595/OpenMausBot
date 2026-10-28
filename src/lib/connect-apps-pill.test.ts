// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CONNECT_APPS_PILL_KEY,
  connectAppsPillDismissed,
  dismissConnectAppsPill,
  restoreConnectAppsPill,
  subscribeConnectAppsPill,
} from "./connect-apps-pill";


function memoryStorage(failWrites = false): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => { values.clear(); },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => { values.delete(key); },
    setItem: (key: string, value: string) => {
      if (failWrites) throw new Error("storage blocked");
      values.set(key, String(value));
    },
  };
}

beforeEach(() => {
  Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage() });
  restoreConnectAppsPill();
  window.localStorage.clear();
});

describe("the Connect apps pill preference", () => {
  it("starts shown and saves a dismissal immediately", () => {
    expect(connectAppsPillDismissed()).toBe(false);
    dismissConnectAppsPill();
    expect(connectAppsPillDismissed()).toBe(true);
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBe("1");
  });

  it("clears the saved flag when the pill is restored", () => {
    dismissConnectAppsPill();
    restoreConnectAppsPill();
    expect(connectAppsPillDismissed()).toBe(false);
    expect(window.localStorage.getItem(CONNECT_APPS_PILL_KEY)).toBeNull();
  });

  it("tells the sidebar at once and stops after unsubscribe", () => {
    const heard = vi.fn();
    const unsubscribe = subscribeConnectAppsPill(heard);
    dismissConnectAppsPill();
    expect(heard).toHaveBeenCalledTimes(1);
    restoreConnectAppsPill();
    expect(heard).toHaveBeenCalledTimes(2);
    unsubscribe();
    dismissConnectAppsPill();
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("still dismisses for this session when storage refuses the write", () => {
    Object.defineProperty(window, "localStorage", { configurable: true, value: memoryStorage(true) });
    dismissConnectAppsPill();
    expect(connectAppsPillDismissed()).toBe(true);
    restoreConnectAppsPill();
    expect(connectAppsPillDismissed()).toBe(false);
  });
});
