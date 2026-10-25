// An engine host runs a customAcp engine on another machine over ssh. The harness maps the turn's folder into a
// workspace root the user mounts or syncs there, and the engine reaches this server only through an `ssh -R` forward to
// the bearer-only listener (server/internal-listener.ts).
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { isValidSshAlias } from "../../config.ts";

export interface EngineHost {
  /** An alias from the user's ssh config. */
  alias: string;
  /** `local` is a folder on this machine; `remote` is the same tree on the host. Both absolute. */
  workspace: { local: string; remote: string };
  /** First remote loopback port of the range `remotePortBase` .. `remotePortBase + REMOTE_PORT_RANGE - 1`; one per live session. */
  remotePortBase: number;
}

/** One engine process's reach to a host: its remote port, where it works there, and whether its ssh client was started. */
export interface RemoteLaunch {
  host: EngineHost;
  threadId: string;
  port: number;
  internalPort: number;
  cwd: string;
  sshPath: string;
  spawned: boolean;
}

export const DEFAULT_REMOTE_PORT_BASE = 18900;
export const REMOTE_PORT_RANGE = 64;

export type EngineHostFailure = "host-config" | "workspace-unmapped" | "no-listener" | "no-free-port";

export class EngineHostError extends Error {
  readonly reason: EngineHostFailure;

  constructor(reason: EngineHostFailure, message: string) {
    super(message);
    this.name = "EngineHostError";
    this.reason = reason;
  }
}

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function decodeEngineHost(raw: unknown): EngineHost | undefined {
  if (raw === undefined || raw === null) return undefined;
  const bad = (why: string) => new EngineHostError("host-config", `engine host: ${why}`);
  if (typeof raw !== "object" || Array.isArray(raw)) throw bad("`host` must be an object");
  const host: Record<string, unknown> = { ...raw };
  if (!isValidSshAlias(host.alias)) throw bad("`host.alias` must be an ssh config alias");
  const workspace = host.workspace;
  if (typeof workspace !== "object" || workspace === null) throw bad("`host.workspace` needs `local` and `remote` folders");
  const { local, remote } = workspace as Record<string, unknown>;
  if (typeof local !== "string" || !isAbsolute(local)) throw bad("`host.workspace.local` must be an absolute path");
  if (typeof remote !== "string" || !posix.isAbsolute(remote)) throw bad("`host.workspace.remote` must be an absolute POSIX path");
  const base = host.remotePortBase ?? DEFAULT_REMOTE_PORT_BASE;
  if (typeof base !== "number" || !Number.isInteger(base) || base < 1024 || base + REMOTE_PORT_RANGE - 1 > 65535) {
    throw bad(`\`host.remotePortBase\` must be an integer from 1024 to ${65535 - REMOTE_PORT_RANGE + 1}`);
  }
  return { alias: host.alias, workspace: { local: resolve(local), remote: posix.normalize(remote) }, remotePortBase: base };
}

/** The folder on the host for a turn's local folder, or a refusal: nothing outside `workspace.local` has a counterpart there. */
export function mapWorkspace(host: EngineHost, localCwd: string): string {
  const inside = relative(host.workspace.local, resolve(localCwd));
  if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new EngineHostError("workspace-unmapped", `The working folder ${localCwd} is outside ${host.workspace.local}, the folder mapped to ${host.alias}. Move the work under it or change the host's workspace.`);
  }
  return inside === "" ? host.workspace.remote : posix.join(host.workspace.remote, ...inside.split(sep));
}

const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** The one string ssh hands the host's shell: enter the folder (the engine never starts when it is missing), then replace
 * the shell with the engine. Only `env` is sent, never this process's environment. */
export function remoteCommand(remoteCwd: string, words: readonly string[], env: Readonly<Record<string, string>>): string {
  if (words.length === 0) throw new EngineHostError("host-config", "engine host: the engine command is empty");
  const assignments = Object.entries(env).map(([name, value]) => {
    if (!ENV_NAME.test(name)) throw new EngineHostError("host-config", `engine host: ${JSON.stringify(name)} is not an environment variable name`);
    return `${name}=${quote(value)}`;
  });
  return `cd ${quote(remoteCwd)} && exec env ${[...assignments, ...words.map(quote)].join(" ")}`;
}

/** Multiplexing is off on purpose: a forward requested through a ControlMaster outlives the client that asked for it. */
export function sshArgs(host: EngineHost, remotePort: number, internalPort: number, command: string): string[] {
  return ["-T", "-o", "ControlMaster=no", "-o", "ControlPath=none", "-o", "ExitOnForwardFailure=yes", "-o", "BatchMode=yes",
    "-R", `127.0.0.1:${remotePort}:127.0.0.1:${internalPort}`, host.alias, "--", command];
}

/** One remote port per engine process on a host: the forward lives and dies with that process's ssh client. */
export class RemotePorts {
  readonly #taken = new Map<string, Set<number>>();

  acquire(alias: string, base: number): number {
    const onHost = this.#taken.get(alias) ?? new Set<number>();
    this.#taken.set(alias, onHost);
    for (let port = base; port < base + REMOTE_PORT_RANGE; port++) {
      if (onHost.has(port)) continue;
      onHost.add(port);
      return port;
    }
    throw new EngineHostError("no-free-port", `engine host ${alias} already runs ${REMOTE_PORT_RANGE} sessions`);
  }

  release(alias: string, port: number): void {
    const onHost = this.#taken.get(alias);
    onHost?.delete(port);
    if (onHost?.size === 0) this.#taken.delete(alias);
  }
}

export const remotePorts = new RemotePorts();
