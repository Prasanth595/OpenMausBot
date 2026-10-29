/**
 * A file the bot can actually read.
 *
 * A committed attachment reaches a turn as `<attached-file path="…" />`. A bot
 * with its own computer can open that path; a bot without one — every bot this
 * app runs on a box, on a phone, or beside a client — cannot, so "here is my
 * spreadsheet" was answered with "I could not open the file". The bucket gives
 * a signed URL, which helps only a bot that can fetch URLs.
 *
 * This module closes the last gap: when the file is plain text (csv, json, md,
 * logs, tsv, whatever the upload declared as text) and small enough to be worth
 * reading, its content travels inside the turn as ordinary text. Binary files
 * keep their tag and the bucket URL; nothing is guessed about their insides.
 *
 * Off unless the file is text-ish and within the caps, so an install that never
 * attaches a text file sends exactly what it sent before.
 */
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { ATTACHMENTS_DIR } from "./attachments.ts";
import { decodeAttachmentAttribute } from "./message-file.ts";

/** One file's worth of text; a longer file is cut, never dropped. */
export const FILE_INLINE_MAX_BYTES = 24 * 1024;
/** Across one turn, so three spreadsheets still fit in a prompt. */
export const TURN_FILE_MAX_BYTES = 48 * 1024;
export const TURN_FILE_MAX_COUNT = 3;

const TEXT_EXTENSIONS = new Set([
  "csv", "tsv", "txt", "md", "json", "ndjson", "jsonl", "xml", "yaml", "yml", "log", "ini", "conf", "env", "sql", "html", "htm", "srt", "vtt",
]);

const FILE_TAG = /^[\t ]*<attached-file[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>[\t ]*$/;

export interface InlineFile {
  name: string;
  text: string;
  bytes: number;
  truncated: boolean;
}

export interface ReadFilesOptions {
  attachmentsDir?: string;
  maxCount?: number;
  maxBytes?: number;
  perFileMaxBytes?: number;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** Text-ish by extension when there is one, by sniffed NUL bytes when there is not. */
function looksLikeText(name: string, bytes: Buffer): boolean {
  if (TEXT_EXTENSIONS.has(extensionOf(name))) return true;
  const head = bytes.subarray(0, Math.min(bytes.length, 4096));
  if (head.includes(0)) return false;
  return true;
}

/** Only a file this app saved in its own attachments dir is read, never an arbitrary path from a message. */
function ownedPath(path: string, attachmentsDir: string): string | null {
  const absolute = resolve(path);
  const dir = resolve(attachmentsDir);
  if (dirname(absolute) !== dir) return null;
  if (!/^[\w.-]+$/.test(basename(absolute))) return null;
  return absolute;
}

/** The text files this turn carries, in the order they were attached. */
export function inlineFiles(
  text: string,
  options: ReadFilesOptions = {},
): InlineFile[] {
  const attachmentsDir = options.attachmentsDir ?? ATTACHMENTS_DIR;
  const maxCount = options.maxCount ?? TURN_FILE_MAX_COUNT;
  const perFileMaxBytes = options.perFileMaxBytes ?? FILE_INLINE_MAX_BYTES;
  let budget = options.maxBytes ?? TURN_FILE_MAX_BYTES;
  const files: InlineFile[] = [];
  if (!text.includes("<attached-file")) return files;

  for (const line of text.split("\n")) {
    if (files.length >= maxCount) break;
    const match = FILE_TAG.exec(line);
    if (!match) continue;
    const path = ownedPath(decodeAttachmentAttribute(match[1]!), attachmentsDir);
    if (!path) continue;
    const label = match[2] ? decodeAttachmentAttribute(match[2]!) : basename(path);
    try {
      const size = statSync(path).size;
      if (!size || budget <= 0) continue;
      const room = Math.min(perFileMaxBytes, budget);
      const bytes = readFileSync(path).subarray(0, room);
      if (!looksLikeText(label, bytes)) continue;
      // A cut in the middle of a multi-byte character would ship a broken char.
      const body = bytes.toString("utf8").replace(/\uFFFD$/, "");
      if (!body.trim()) continue;
      files.push({ name: label, text: body, bytes: size, truncated: size > bytes.length });
      budget -= bytes.length;
    } catch {
      continue;
    }
  }
  return files;
}

/** The block a turn gets instead of a path it cannot open; empty when nothing was read. */
export function fileBlock(files: readonly InlineFile[]): string {
  if (!files.length) return "";
  return [
    "The attached file(s) were read for you; here is their content:",
    ...files.map((file, index) => {
      const size = file.bytes < 1024 ? `${file.bytes} bytes` : `${Math.round(file.bytes / 1024)} KB`;
      const cut = file.truncated ? "; only the beginning is shown" : "";
      return `--- file ${index + 1}: ${file.name} (${size}${cut}) ---\n${file.text.trimEnd()}`;
    }),
  ].join("\n\n");
}
