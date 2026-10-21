// The browser-control extension's allowlist is the user's only boundary on
// which pages a bot may read and drive. These tests drive the real service
// worker with a stubbed `chrome` and the real WebSocket command path, so a
// regression that turns the gate back into a no-op fails here.
//
// The bug this guards: `hostAllowed()` used to return `true` for every host
// while the real check sat in `injectableTabs()` — a function nothing called.
// The options page's "allow all sites" switch did nothing at all.
import { beforeEach, describe, expect, it, vi } from "vitest";

interface StoredState {
  serverUrl: string;
  token: string;
  allowlist: string;
  [key: string]: unknown;
}

const DEFAULT_STORAGE: StoredState = {
  serverUrl: "ws://127.0.0.1:8787",
  token: "test-token",
  allowlist: "example.com",
};

interface CommandResponse {
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  private listeners = new Map<string, Array<(payload: unknown) => void>>();

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(name: string, fn: (payload: unknown) => void): void {
    const list = this.listeners.get(name) ?? [];
    list.push(fn);
    this.listeners.set(name, list);
  }

  send(): void {
    // The real socket writes to the network; the tests read the answers
    // through the reply hook installed below.
  }

  close(): void {
    this.readyState = 3;
  }

  emit(name: string, payload: unknown): void {
    for (const fn of this.listeners.get(name) ?? []) fn(payload);
  }
}

/** The chrome APIs the service worker touches, and nothing else. */
function installChrome(storage: Partial<StoredState>, tabUrl: string) {
  const state: StoredState = { ...DEFAULT_STORAGE, ...storage };
  const tabs: Array<{ id: number; url: string; windowId: number }> = [{ id: 7, url: tabUrl, windowId: 3 }];
  const updateCalls: Array<{ tabId: number; url: string }> = [];
  let installedListener: (() => unknown) | null = null;

  const chromeStub = {
    storage: {
      local: {
        async get(keys: string | string[]) {
          const names = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const name of names) if (name in state) out[name] = state[name];
          return out;
        },
        async set(patch: Record<string, unknown>) {
          Object.assign(state, patch);
        },
      },
    },
    runtime: {
      onMessage: { addListener() {} },
      onInstalled: {
        addListener(fn: () => unknown) {
          installedListener = fn;
        },
      },
      onStartup: { addListener() {} },
      getManifest: () => ({ version: "0.1.0.0" }),
      sendMessage: async () => {},
    },
    tabs: {
      query: async () => tabs,
      update: async (tabId: number, props: { url: string }) => {
        updateCalls.push({ tabId, url: props.url });
        return { id: tabId };
      },
      sendMessage: async () => ({ title: "Example", url: tabUrl, text: "body", links: [], inputs: [] }),
      captureVisibleTab: async () => "data:image/jpeg;base64,AAAA",
    },
    scripting: {
      executeScript: async () => [{ result: "evaluated" }],
      insertCSS: async () => {},
    },
  };

  (globalThis as Record<string, unknown>).chrome = chromeStub;
  (globalThis as Record<string, unknown>).WebSocket = FakeSocket;
  return {
    state,
    updateCalls,
    installedListener: () => installedListener,
  };
}

/** Load the worker, connect it, and return a function that sends a command
 *  and resolves with the worker's answer. */
async function connectAndCommand(tabUrl: string, storage: Partial<StoredState> = {}) {
  const { updateCalls, installedListener } = installChrome(storage, tabUrl);
  // The worker registers its listeners and connects on install; resetting the
  // module registry gives each test a fresh worker with the stubbed chrome
  // already in scope.
  vi.resetModules();
  await import("./background.js");
  // The install listener is what opens the socket in a real profile.
  await installedListener()?.();
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error("the worker did not open a socket");
  socket.emit("open", {});

  let pending: ((response: CommandResponse) => void) | null = null;
  const sent: unknown[] = [];
  socket.send = (...args: unknown[]) => {
    const payload = JSON.parse(String(args[0])) as CommandResponse & { type?: string };
    sent.push(payload);
    // The worker's "hello" handshake carries no id; only answers to a command
    // resolve the pending command.
    if (payload.id) {
      const resolve = pending;
      pending = null;
      resolve?.(payload);
    }
  };

  const command = (action: string, args: Record<string, unknown> = {}) => {
    const answer = new Promise<CommandResponse>((resolve) => {
      pending = resolve;
    });
    socket.emit("message", { data: JSON.stringify({ id: "1", action, ...args }) });
    return answer;
  };

  return { command, updateCalls, sent };
}

describe("browser-control allowlist", () => {
  beforeEach(() => {
    FakeSocket.instances.length = 0;
  });

  it("refuses to read a page whose host is not allowlisted", async () => {
    const { command } = await connectAndCommand("https://not-allowed.test/page");
    expect(await command("read")).toMatchObject({ ok: false, error: "Host is not in the allowlist" });
  });

  it("refuses to drive, type into, screenshot, or evaluate on a host that is not allowlisted", async () => {
    for (const action of ["click", "type", "press", "scroll", "read", "eval", "screenshot"]) {
      const { command } = await connectAndCommand("https://not-allowed.test/page");
      const answer = await command(action, { selector: "#a", text: "x", key: "Enter", expression: "1" });
      expect(answer, action).toMatchObject({ ok: false, error: "Host is not in the allowlist" });
    }
  });

  it("allows a host on the list, and a subdomain of it", async () => {
    for (const url of ["https://example.com/page", "https://app.example.com/page"]) {
      const { command } = await connectAndCommand(url);
      expect(await command("read"), url).toMatchObject({ ok: true });
    }
  });

  it("allows every web page when the user left the list empty", async () => {
    const { command } = await connectAndCommand("https://anywhere.test/page", { allowlist: "" });
    expect(await command("read")).toMatchObject({ ok: true });
  });

  it("reads a comma-separated list the same way as a newline-separated one", async () => {
    const { command } = await connectAndCommand("https://docs.example.org/page", {
      allowlist: "example.com, docs.example.org",
    });
    expect(await command("read")).toMatchObject({ ok: true });
  });

  it("refuses to navigate to a host that is not allowlisted", async () => {
    const { command } = await connectAndCommand("https://example.com/page");
    expect(await command("navigate", { url: "https://not-allowed.test/other" })).toMatchObject({
      ok: false,
      error: "Host is not in the allowlist",
    });
  });

  it("navigates to an allowlisted host from anywhere", async () => {
    const { command, updateCalls } = await connectAndCommand("https://not-allowed.test/page");
    expect(await command("navigate", { url: "https://example.com/other" })).toMatchObject({ ok: true });
    expect(updateCalls).toEqual([{ tabId: 7, url: "https://example.com/other" }]);
  });

  it("refuses a non-web page even when the list is empty", async () => {
    const { command } = await connectAndCommand("chrome://settings/", { allowlist: "" });
    expect(await command("read")).toMatchObject({ ok: false, error: "This tab is not a web page" });
  });
});
