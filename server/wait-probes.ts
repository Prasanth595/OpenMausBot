import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { join } from "node:path";
import { promisify } from "node:util";

import { resolveTarget } from "./browser/egress/gate.ts";
import { addressClass, ownAddresses } from "./browser/egress/policy.ts";

export interface FileStamp {
  size: number;
  mtimeMs: number;
}

export interface ProcessEntry {
  pid: number;
  name: string;
}

const execFileAsync = promisify(execFile);

export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(home, path.slice(2));
  return path;
}

export async function fileStamp(path: string): Promise<FileStamp | null> {
  try {
    const info = await stat(path);
    return { size: info.size, mtimeMs: info.mtimeMs };
  } catch {
    return null;
  }
}

export function fileChanged(before: FileStamp | null, now: FileStamp | null): boolean {
  if (!now) return false;
  if (!before) return true;
  return before.size !== now.size || before.mtimeMs !== now.mtimeMs;
}

export function parsePs(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const name = match[2].slice(match[2].lastIndexOf("/") + 1);
    if (name) entries.push({ pid: Number(match[1]), name });
  }
  return entries;
}

export function parseTasklist(stdout: string): ProcessEntry[] {
  const entries: ProcessEntry[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^"([^"]*)","(\d+)"/.exec(line);
    if (match) entries.push({ pid: Number(match[2]), name: match[1] });
  }
  return entries;
}

async function runFile(file: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(file, args, {
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout;
}

export async function listProcesses(
  platform: NodeJS.Platform = process.platform,
  run: (file: string, args: string[]) => Promise<string> = runFile,
): Promise<ProcessEntry[]> {
  if (platform === "win32") return parseTasklist(await run("tasklist", ["/fo", "csv", "/nh"]));
  return parsePs(await run("ps", ["-axo", "pid=,comm="]));
}

export function processRunning(entries: readonly ProcessEntry[], wanted: string): boolean {
  const target = wanted.trim();
  if (/^\d+$/.test(target)) return entries.some((entry) => entry.pid === Number(target));
  const lower = target.toLowerCase();
  const withExe = lower.endsWith(".exe") ? lower : `${lower}.exe`;
  const withoutExe = lower.endsWith(".exe") ? lower.slice(0, -4) : lower;
  return entries.some((entry) => {
    const name = entry.name.toLowerCase();
    if (name === lower || name === withExe || name === withoutExe) return true;
    return name.length === 15 && name === lower.slice(0, 15);
  });
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, body: string) => {
    const named = NAMED_ENTITIES[body.toLowerCase()];
    if (named !== undefined) return named;
    if (body[0] !== "#") return whole;
    const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

export function pageText(body: string): string {
  const stripped = body
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]*>/g, " ");
  return decodeEntities(stripped).replace(/\s+/g, " ").trim();
}

export function pageSays(text: string, wanted: string): boolean {
  const needle = wanted.replace(/\s+/g, " ").trim().toLowerCase();
  return text.toLowerCase().includes(needle);
}

export const PAGE_TIMEOUT_MS = 15_000;
export const PAGE_MAX_BYTES = 2 * 1024 * 1024;
export const PAGE_MAX_REDIRECTS = 3;

export type PageResult = { ok: true; text: string } | { ok: false; refused: boolean; error: string };

export interface PageFetchOptions {
  allow?: (target: { host: string; address: string }) => boolean;
  lookup?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  timeoutMs?: number;
  maxBytes?: number;
}

type Answer = { status: number; location?: string; body: Buffer };

const fail = (error: string, refused = false): PageResult => ({ ok: false, refused, error });

function requestOnce(url: URL, address: { address: string; family: number }, signal: AbortSignal, maxBytes: number): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const pinned: LookupFunction = (_host, lookupOptions, callback) => {
      if (lookupOptions.all) callback(null, [address]);
      else callback(null, address.address, address.family);
    };
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = send(
      url,
      {
        agent: false,
        signal,
        lookup: pinned,
        headers: { "user-agent": "OpenMausBot-wait", accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      },
      (response: IncomingMessage) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;
        if (status < 200 || status >= 300) {
          response.destroy();
          resolve({ status, location, body: Buffer.alloc(0) });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
          size += chunk.length;
          if (size >= maxBytes) {
            response.destroy();
            resolve({ status, body: Buffer.concat(chunks).subarray(0, maxBytes) });
          }
        });
        response.on("end", () => resolve({ status, body: Buffer.concat(chunks) }));
        response.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function withinSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function fetchPageText(rawUrl: string, options: PageFetchOptions = {}): Promise<PageResult> {
  const lookup = options.lookup ?? resolveTarget;
  const allow = options.allow ?? (({ address }) => addressClass(address, ownAddresses()) === "public");
  const maxBytes = options.maxBytes ?? PAGE_MAX_BYTES;
  const signal = AbortSignal.timeout(options.timeoutMs ?? PAGE_TIMEOUT_MS);
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("That is not a web address.", true);
  }
  try {
    for (let hop = 0; ; hop++) {
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        return fail("Only an http or https address with no sign-in details can be checked.", true);
      }
      const host = url.hostname.replace(/^\[|\]$/g, "");
      const literal = isIP(host);
      const addresses = literal ? [{ address: host, family: literal }] : await withinSignal(lookup(host), signal);
      if (addresses.length === 0) return fail("That address could not be found.");
      if (!addresses.every(({ address }) => allow({ host, address }))) {
        return fail(`${host} points at this computer or a private network, which waits never check.`, true);
      }
      signal.throwIfAborted();
      const answer = await requestOnce(url, addresses[0], signal, maxBytes);
      if (answer.status >= 300 && answer.status < 400 && answer.location) {
        if (hop >= PAGE_MAX_REDIRECTS) return fail("The page redirected too many times.");
        url = new URL(answer.location, url);
        continue;
      }
      if (answer.status < 200 || answer.status >= 300) return fail(`The page answered ${answer.status}.`);
      return { ok: true, text: pageText(answer.body.toString("utf8")) };
    }
  } catch {
    return signal.aborted ? fail("The page took too long to answer.") : fail("The page could not be reached.");
  }
}
