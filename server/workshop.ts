// The app's "workshop": a sandbox crate where agents can create reusable
// resources of their own — prompt fragments, runbooks, drafts, skill notes —
// without touching anything else on disk.
//
// The whole subsystem is opt-in (`features.workshop` in the config, or
// `OMB_WORKSHOP=1`) and read per request, so the operator's switch takes
// effect without a restart. Everything an agent can touch lives under
// DATA_DIR/workshop — plain data, never source, so there is no journal,
// no trial boot, and nothing to auto-revert: the operator can inspect and
// edit the crate like any other file in the data dir.
//
// The rules are the whole safety story, and they are enforced here before
// a single write reaches disk:
// - names are a single path segment, 1–64 chars, `[A-Za-z0-9._-]` only,
//   no `.` prefix — so no traversal, no dotfiles, no hidden state;
// - extensions are `.md`, `.txt`, `.json`, or `.svg`, and `.json` must
//   parse. `.svg` exists for the workshop's figure flow (bots sketching
//   isometric figures for their operator); the panel serves them behind a
//   no-scripts CSP and previews them through <img>, so a figure stays a
//   drawing even if it carries hostile markup — agents are still told to
//   write declarative CSS/SMIL animation only;
// - at most 24 files, each at most 64 KiB, so a runaway turn cannot fill
//   the user's disk;
// - content must be plain UTF-8 text (it arrives as a string or not at
//   all — there is no binary path).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";

import { DATA_DIR } from "./config.ts";

export const WORKSHOP_DIR = join(DATA_DIR, "workshop");

const MAX_FILES = 24;
const MAX_BYTES = 64 * 1024;
const ALLOWED_SUFFIXES = [".md", ".txt", ".json", ".svg"] as const;
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface WorkshopListItem {
  name: string;
  bytes: number;
  updatedAt: string;
  sha256: string;
}

/** `name` — 1–64 chars, [A-Za-z0-9._-], no leading dot — plus one allowed
 * suffix. A name that fails this can never leave the crate. */
export function validWorkshopName(name: unknown): name is string {
  if (typeof name !== "string") return false;
  if (isAbsolute(name)) return false;
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) return false;
  if (!NAME_RE.test(name)) return false;
  if (name === "." || name === "..") return false;
  return ALLOWED_SUFFIXES.some((suffix) => name.endsWith(suffix) && name.length > suffix.length);
}

/** A short reason a name was refused — for the API response and the
 * agent-facing tool's error text. Empty string when the name is valid. */
export function workshopNameError(name: unknown): string {
  if (validWorkshopName(name)) return "";
  if (typeof name !== "string") return "name must be a string";
  if (!name.trim()) return "name must not be empty";
  if (name.length > 64) return "name must be at most 64 characters";
  if (!/^[A-Za-z0-9]/.test(name)) return "name must start with a letter or digit (no leading dot — hidden files are refused)";
  if (!NAME_RE.test(name)) {
    return "name may only contain letters, digits, dots, dashes, and underscores";
  }
  return `name must end in one of: ${ALLOWED_SUFFIXES.join(", ")}`;
}

function listing(name: string, fullPath: string): WorkshopListItem {
  const bytes = statSync(fullPath).size;
  const content = readFileSync(fullPath, "utf8");
  return {
    name,
    bytes,
    updatedAt: statSync(fullPath).mtime.toISOString(),
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function ensureCrate(): string {
  mkdirSync(WORKSHOP_DIR, { recursive: true });
  return WORKSHOP_DIR;
}

export function listWorkshop(): WorkshopListItem[] {
  if (!existsSync(WORKSHOP_DIR)) return [];
  return readdirSync(WORKSHOP_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && validWorkshopName(entry.name))
    .map((entry) => listing(entry.name, join(WORKSHOP_DIR, entry.name)))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function readWorkshop(name: string): { ok: true; name: string; content: string; bytes: number; updatedAt: string } | { ok: false; status: number; error: string } {
  if (!validWorkshopName(name)) return { ok: false, status: 400, error: workshopNameError(name) };
  const fullPath = join(WORKSHOP_DIR, name);
  if (!existsSync(fullPath)) return { ok: false, status: 404, error: `no workshop resource named ${name}` };
  const content = readFileSync(fullPath, "utf8");
  return { ok: true, name, content, bytes: statSync(fullPath).size, updatedAt: statSync(fullPath).mtime.toISOString() };
}

/** Write or fully replace a resource by its whole content. A resource that
 * exists is overwritten outright — the workshop is a scratch crate, not a
 * journal; the caller (a bot turn) is expected to have read what it is
 * replacing, and every write lands as plain file bytes the operator can
 * open or edit directly. */
export function writeWorkshop(name: string, content: unknown): { ok: true; entry: WorkshopListItem } | { ok: false; status: number; error: string } {
  if (!validWorkshopName(name)) return { ok: false, status: 400, error: workshopNameError(name) };
  if (typeof content !== "string") return { ok: false, status: 400, error: "content must be a string — the workshop takes whole text files, not diffs" };
  const body = Buffer.from(content, "utf8");
  if (body.length > MAX_BYTES) {
    return { ok: false, status: 413, error: `content is ${body.length} bytes; the limit is ${MAX_BYTES} (64 KiB) per resource` };
  }
  if (name.endsWith(".json")) {
    try {
      JSON.parse(content);
    } catch (error) {
      return { ok: false, status: 400, error: `a .json resource must be valid JSON: ${error instanceof Error ? error.message : String(error)}` };
    }
  }
  ensureCrate();
  const existing = existsSync(join(WORKSHOP_DIR, name));
  if (!existing && listWorkshop().length >= MAX_FILES) {
    return { ok: false, status: 409, error: `the workshop holds ${MAX_FILES} resources — delete one before creating another` };
  }
  writeFileSync(join(WORKSHOP_DIR, name), content, { encoding: "utf8", mode: 0o600 });
  return { ok: true, entry: listing(name, join(WORKSHOP_DIR, name)) };
}

export function deleteWorkshop(name: string): { ok: true; name: string } | { ok: false; status: number; error: string } {
  if (!validWorkshopName(name)) return { ok: false, status: 400, error: workshopNameError(name) };
  const fullPath = join(WORKSHOP_DIR, name);
  if (!existsSync(fullPath)) return { ok: false, status: 404, error: `no workshop resource named ${name}` };
  rmSync(fullPath);
  return { ok: true, name };
}
