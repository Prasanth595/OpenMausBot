// An upload lives in the app's attachment store, not in the bot's working folder: a turn that names that path hands
// the bot a file its own tools cannot open. Mirrored by a hard link into the bot's workspace, the same bytes get a
// path the bot can read, and the mirror outlives the end-of-turn purge of the original entry.
import { chmodSync, constants, copyFileSync, linkSync, lstatSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { basename, join, resolve } from "node:path";

import { ATTACHMENTS_DIR } from "./attachments.ts";
import { decodeAttachmentAttribute } from "./message-file.ts";

/** Folder inside the bot's own workspace where a turn's attachments appear. */
export const ATTACHMENT_LINK_DIR = "anexos";

/** saveFile/saveImage name every upload `<uuid><ext>`; any other name in a tag is the client's word, not this store's. */
const STORED_UPLOAD_NAME = /^[A-Za-z0-9-]{1,128}\.[A-Za-z0-9]{1,16}$/;

/** The shape the composer writes and turn-images.ts reads: path first, an optional name second. */
const ATTACHMENT_TAG = /<attached-(?:image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>/g;

const PATH_ATTRIBUTE = 'path="';

export interface LinkedAttachment {
  /** The store path the message named. */
  from: string;
  /** The path inside the bot's workspace the turn now names. */
  path: string;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\r", "&#13;")
    .replaceAll("\n", "&#10;");
}

/** Links `source` into `directory` under its own name and reuses a mirror that is already there. Null when the bytes are gone. */
function mirrorInto(directory: string, source: string): string | null {
  const destination = join(directory, basename(source));
  try {
    const entry = lstatSync(source);
    if (!entry.isFile() || entry.size <= 0) return null;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const existing = statSync(destination, { throwIfNoEntry: false });
    if (existing?.isFile()) {
      if (existing.ino === entry.ino) return destination;
      // Same name and size: the earlier mirror of this very upload, never a different file.
      if (existing.size === entry.size) return destination;
      unlinkSync(destination);
    }
    linkSync(source, destination);
    return destination;
  } catch {
    // A second filesystem in the data dir (a bind mount, a network home) has no hard links; a private copy still works.
    try {
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
      chmodSync(destination, 0o600);
      return destination;
    } catch {
      return null;
    }
  }
}

/**
 * Rewrites every attachment tag that names a file in the app's store to the mirror inside `workspace`.
 * Tags naming anything else, and uploads whose bytes are already gone, stay exactly as the client sent them.
 */
export function linkTurnAttachments(
  text: string,
  options: { workspace: string; attachmentsDir?: string },
): { text: string; linked: LinkedAttachment[] } {
  if (!text.includes("<attached-")) return { text, linked: [] };
  const attachmentsDir = resolve(options.attachmentsDir ?? ATTACHMENTS_DIR);
  const directory = join(options.workspace, ATTACHMENT_LINK_DIR);
  const linked: LinkedAttachment[] = [];
  let rewritten = "";
  let cursor = 0;
  for (const match of text.matchAll(ATTACHMENT_TAG)) {
    const named = decodeAttachmentAttribute(match[1]!);
    const name = basename(named);
    if (!STORED_UPLOAD_NAME.test(name)) continue;
    const source = resolve(attachmentsDir, name);
    // A basename match alone would let any path pose as an upload: the tag must name this store's own copy.
    if (source !== resolve(named)) continue;
    const destination = mirrorInto(directory, source);
    if (!destination) continue;
    const offset = (match.index ?? 0) + match[0].indexOf(PATH_ATTRIBUTE) + PATH_ATTRIBUTE.length;
    rewritten += text.slice(cursor, offset) + escapeAttribute(destination);
    cursor = offset + match[1]!.length;
    linked.push({ from: source, path: destination });
  }
  if (linked.length === 0) return { text, linked };
  return { text: rewritten + text.slice(cursor), linked };
}
