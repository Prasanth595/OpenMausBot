import { useSyncExternalStore } from "react";

/** Device-local: the client store exposes no workspace id, so the key is namespaced and belongs to this install. */
export const CONNECT_APPS_PILL_KEY = "omb-connect-apps-pill-dismissed";

/** Storage can be missing (SSR) or blocked (private mode); a dismissal still holds for this session. */
let sessionDismissed = false;
const listeners = new Set<() => void>();

function storage(): Storage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export function connectAppsPillDismissed(): boolean {
  if (sessionDismissed) return true;
  try {
    return storage()?.getItem(CONNECT_APPS_PILL_KEY) === "1";
  } catch {
    return false;
  }
}

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // One subscriber must not stop the others from hearing the change.
    }
  }
}

export function dismissConnectAppsPill(): void {
  sessionDismissed = true;
  try {
    storage()?.setItem(CONNECT_APPS_PILL_KEY, "1");
  } catch {
    // Storage can be full or blocked in private mode; the dismissal still applies this session.
  }
  emit();
}

export function restoreConnectAppsPill(): void {
  sessionDismissed = false;
  try {
    storage()?.removeItem(CONNECT_APPS_PILL_KEY);
  } catch {
    // Nothing to clear if storage cannot be reached.
  }
  emit();
}

export function subscribeConnectAppsPill(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useConnectAppsPillDismissed(): boolean {
  return useSyncExternalStore(subscribeConnectAppsPill, connectAppsPillDismissed, () => false);
}
