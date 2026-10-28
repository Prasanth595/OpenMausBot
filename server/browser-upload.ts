import { randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";

import { safeFileName } from "./browser/cdp/downloads.ts";

const MAX_FILES = 10;
// Node 24 omits Darwin's O_NOFOLLOW_ANY, which rejects symlinks in every path component.
const O_NOFOLLOW_ANY = 0x20000000;
const NAMED_COPY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function realRoot(root: string): string | null {
  try { return realpathSync(root); } catch { return null; }
}

function inside(root: string, file: string): boolean {
  const path = relative(root, file);
  return path !== "" && !path.startsWith("..") && !isAbsolute(path);
}

/** A page may receive only the person's attachments and the bot's own folders; symlinks are followed before the check. */
export function uploadableFiles(files: unknown, roots: readonly string[]): { files: string[] } | { error: string } {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES || !files.every((file) => typeof file === "string" && file)) {
    return { error: `files must list 1 to ${MAX_FILES} absolute file paths.` };
  }
  const allowed = roots.flatMap((root) => realRoot(root) ?? []);
  const resolved: string[] = [];
  for (const file of files as string[]) {
    const path = file.startsWith("~/") ? join(homedir(), file.slice(2)) : file;
    if (!isAbsolute(path)) return { error: `${file} is not an absolute path.` };
    let real: string;
    try { real = realpathSync(path); } catch { return { error: `${file} does not exist.` }; }
    if (!allowed.some((root) => inside(root, real))) {
      return { error: `${file} is not one of this conversation's attachments or in your working folder, so it cannot be uploaded. Ask the person to attach the file.` };
    }
    if (!statSync(real).isFile()) return { error: `${file} is not a file.` };
    resolved.push(real);
  }
  return { files: resolved };
}

/** Chrome names an uploaded file after its file on disk and reads it only when the form is sent, so an attachment stored
 * under a random id gets a copy with the person's own name that outlives the call. `everyFile`: stage every file in
 * `folder`, outside the bot's writable workspace. */
export function namedUploadPaths(files: ReadonlyArray<{ file: string; name: string | null }>, folder: string, now = Date.now(), { everyFile = false } = {}): string[] {
  sweepNamedCopies(folder, now);
  return files.map(({ file, name: given }) => {
    const name = given && basename(given) === given ? given : everyFile ? basename(file) : null;
    if (!name || (name === basename(file) && !everyFile)) return file;
    const dir = join(folder, randomUUID());
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const named = join(dir, name);
    try { copyUpload(file, named); } catch (error) {
      rmSync(dir, { recursive: true, force: true });
      throw error;
    }
    return named;
  });
}

function copyUpload(source: string, destination: string): void {
  if (process.platform === "win32" && !lstatSync(source).isFile()) throw new Error(`${source} is not a file.`);
  const input = openSync(source, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK | (process.platform === "darwin" ? O_NOFOLLOW_ANY : 0)));
  let output: number | undefined;
  try {
    if (process.platform === "linux" && readlinkSync(`/proc/self/fd/${input}`) !== source) throw new Error(`${source} changed while staging the upload.`);
    const file = fstatSync(input);
    if (!file.isFile()) throw new Error(`${source} is not a file.`);
    output = openSync(destination, "wx", 0o600);
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    for (let remaining = file.size; remaining > 0;) {
      const count = readSync(input, chunk, 0, Math.min(chunk.length, remaining), null);
      if (!count) throw new Error(`${source} changed while staging the upload.`);
      let offset = 0;
      while (offset < count) offset += writeSync(output, chunk, offset, count - offset);
      remaining -= count;
    }
  } finally {
    closeSync(input);
    if (output !== undefined) closeSync(output);
  }
}

/** Files a person picked on their own device for a page's file picker, kept under their own names for a day. */
export function storeUploads(files: ReadonlyArray<{ name: string; bytes: Uint8Array }>, folder: string, now = Date.now()): string[] {
  sweepNamedCopies(folder, now);
  return files.map(({ name, bytes }) => {
    const dir = join(folder, randomUUID());
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, safeFileName(name));
    writeFileSync(path, bytes, { mode: 0o600 });
    return path;
  });
}

function sweepNamedCopies(folder: string, now: number): void {
  let entries: string[];
  try { entries = readdirSync(folder); } catch { return; }
  for (const entry of entries) {
    const dir = join(folder, entry);
    try { if (now - statSync(dir).mtimeMs > NAMED_COPY_MAX_AGE_MS) rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}
