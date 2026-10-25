import { describe, expect, it } from "vitest";

import { DEFAULT_REMOTE_PORT_BASE, EngineHostError, REMOTE_PORT_RANGE, RemotePorts, decodeEngineHost, mapWorkspace, remoteCommand, sshArgs } from "./engine-host.ts";

const host = decodeEngineHost({ alias: "pi-2", workspace: { local: "/data/task-workspaces", remote: "/srv/omb" } })!;

const reason = (fn: () => unknown): string | undefined => {
  try { fn(); } catch (error) { return error instanceof EngineHostError ? error.reason : `other: ${String(error)}`; }
  return undefined;
};

describe("engine host config", () => {
  it("is absent when not configured and defaults the port range", () => {
    expect(decodeEngineHost(undefined)).toBeUndefined();
    expect(host).toEqual({ alias: "pi-2", workspace: { local: "/data/task-workspaces", remote: "/srv/omb" }, remotePortBase: DEFAULT_REMOTE_PORT_BASE });
  });

  it("refuses a malformed host with a config reason", () => {
    const workspace = { local: "/a", remote: "/b" };
    for (const raw of ["pi-2", [], { workspace }, { alias: "a b", workspace }, { alias: "pi", workspace: { local: "a", remote: "/b" } },
      { alias: "pi", workspace: { local: "/a", remote: "b" } }, { alias: "pi", workspace, remotePortBase: 80 }, { alias: "pi", workspace, remotePortBase: 65535 }]) {
      expect(reason(() => decodeEngineHost(raw)), JSON.stringify(raw)).toBe("host-config");
    }
  });
});

describe("workspace mapping", () => {
  it("moves a folder under the local root to the same place under the remote root", () => {
    expect(mapWorkspace(host, "/data/task-workspaces")).toBe("/srv/omb");
    expect(mapWorkspace(host, "/data/task-workspaces/bot/thread")).toBe("/srv/omb/bot/thread");
  });

  it("refuses a folder outside the local root, including a lookalike sibling and a dot-dot escape", () => {
    for (const cwd of ["/etc", "/data/task-workspaces-other/x", "/data/task-workspaces/../secrets", "/data"]) {
      expect(reason(() => mapWorkspace(host, cwd)), cwd).toBe("workspace-unmapped");
    }
  });
});

describe("the remote command", () => {
  it("enters the folder, then replaces the shell with the engine, quoting every word and value", () => {
    expect(remoteCommand("/srv/omb/a b", ["my-agent", "acp", "it's"], { TOKEN: "a'b", EMPTY: "" }))
      .toBe(`cd '/srv/omb/a b' && exec env TOKEN='a'\\''b' EMPTY='' 'my-agent' 'acp' 'it'\\''s'`);
  });

  it("refuses an empty command and a name that is not a variable name", () => {
    expect(reason(() => remoteCommand("/x", [], {}))).toBe("host-config");
    expect(reason(() => remoteCommand("/x", ["a"], { "A-B": "1" }))).toBe("host-config");
  });

  it("forwards a remote loopback port to the listener without multiplexing", () => {
    const args = sshArgs(host, 18900, 8801, "cmd");
    expect(args).toEqual(expect.arrayContaining(["ControlMaster=no", "ControlPath=none", "ExitOnForwardFailure=yes", "127.0.0.1:18900:127.0.0.1:8801", "pi-2"]));
    expect(args.slice(-2)).toEqual(["--", "cmd"]);
  });
});

describe("remote ports", () => {
  it("gives each engine process its own port per host and reuses a freed one", () => {
    const ports = new RemotePorts();
    expect(ports.acquire("pi-2", 18900)).toBe(18900);
    expect(ports.acquire("pi-2", 18900)).toBe(18901);
    expect(ports.acquire("pi-3", 18900)).toBe(18900);
    ports.release("pi-2", 18900);
    expect(ports.acquire("pi-2", 18900)).toBe(18900);
  });

  it("refuses a process past the range", () => {
    const ports = new RemotePorts();
    for (let i = 0; i < REMOTE_PORT_RANGE; i++) ports.acquire("pi-2", 18900);
    expect(reason(() => ports.acquire("pi-2", 18900))).toBe("no-free-port");
  });
});
