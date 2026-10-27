import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

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
