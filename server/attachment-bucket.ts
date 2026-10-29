/**
 * Off-host copy of the files people attach.
 *
 * Today a committed attachment exists only as `${DATA_DIR}/attachments/<uuid>.<ext>`:
 * the volume of the one container that uploaded it, inside a 512 MB quota. A bot
 * that runs anywhere else (a box, a phone, another maus) gets a path it cannot
 * open, and nothing survives the volume. This module archives each committed
 * file in a GCS object and remembers the object's URL, so any turn — on any
 * computer — can fetch the bytes with plain HTTP.
 *
 * No GCS SDK: a service-account JWT and two REST calls. Nothing here runs
 * unless OMB_ATTACHMENTS_BUCKET names a bucket, so an unconfigured image,
 * desktop app or test is byte-for-byte what it was before.
 */
import { createHash, createSign } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { DATA_DIR } from "./config.ts";
import { decodeAttachmentAttribute } from "./message-file.ts";

/** Sidecars live beside the store, never in it: every file there counts against the quota. */
export const BUCKET_RECORDS_DIR = join(DATA_DIR, "attachment-bucket");

const SCOPE = "https://www.googleapis.com/auth/devstorage.read_write";
const TOKEN_LIFETIME_SECONDS = 3600;
/** One signed link lasts a week: longer than any bot needs, short enough to expire. */
const SIGNED_URL_LIFETIME_SECONDS = 7 * 24 * 60 * 60;

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

export interface AttachmentBucketConfig {
  bucket: string;
  prefix: string;
  credentials: ServiceAccount;
  apiBase: string;
  tokenUrl: string;
}

export interface ArchivedAttachment {
  bucket: string;
  object: string;
  url: string;
  at: number;
}

type FetchLike = typeof fetch;

function accountFrom(raw: string | undefined): ServiceAccount | null {
  if (!raw?.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    const email = typeof value.client_email === "string" ? value.client_email.trim() : "";
    const key = typeof value.private_key === "string" ? value.private_key : "";
    return email && key.includes("PRIVATE KEY") ? { client_email: email, private_key: key } : null;
  } catch {
    return null;
  }
}

/** Null unless a bucket and usable credentials are both configured. */
export function attachmentBucketConfig(env: NodeJS.ProcessEnv = process.env): AttachmentBucketConfig | null {
  const bucket = env.OMB_ATTACHMENTS_BUCKET?.trim();
  if (!bucket) return null;
  const credentials = accountFrom(env.OMB_ATTACHMENTS_SA_JSON) ?? accountFrom(env.GCP_SPEECH_SA_JSON);
  if (!credentials) return null;
  const prefix = (env.OMB_ATTACHMENTS_BUCKET_PREFIX?.trim() || "anexos").replace(/^\/+|\/+$/g, "");
  return {
    bucket,
    prefix,
    credentials,
    apiBase: (env.OMB_GCS_API_BASE?.trim() || "https://storage.googleapis.com").replace(/\/+$/, ""),
    tokenUrl: env.OMB_GCS_TOKEN_URL?.trim() || "https://oauth2.googleapis.com/token",
  };
}

const tokens = new Map<string, { token: string; expiresAt: number }>();

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

async function accessToken(config: AttachmentBucketConfig, fetchImpl: FetchLike, now = Date.now()): Promise<string> {
  const cacheKey = `${config.credentials.client_email}|${config.tokenUrl}`;
  const cached = tokens.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;
  const issuedAt = Math.floor(now / 1000);
  const claim = {
    iss: config.credentials.client_email,
    scope: SCOPE,
    aud: config.tokenUrl,
    iat: issuedAt,
    exp: issuedAt + TOKEN_LIFETIME_SECONDS,
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify(claim))}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const assertion = `${unsigned}.${signer.sign(config.credentials.private_key, "base64url")}`;
  const response = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }).toString(),
  });
  if (!response.ok) throw new Error(`GCS token endpoint answered ${response.status}`);
  const body = (await response.json()) as Record<string, unknown>;
  const token = typeof body.access_token === "string" ? body.access_token : "";
  if (!token) throw new Error("GCS token endpoint returned no access_token");
  const lifetime = typeof body.expires_in === "number" && body.expires_in > 0 ? body.expires_in : TOKEN_LIFETIME_SECONDS;
  tokens.set(cacheKey, { token, expiresAt: now + lifetime * 1000 });
  return token;
}

/** Day-partitioned so a year of client files stays listable and deletable by date. */
export function bucketObjectName(prefix: string, name: string, at = Date.now()): string {
  const day = new Date(at).toISOString().slice(0, 10);
  return [prefix, day, name].filter(Boolean).join("/");
}

function objectUrl(apiBase: string, bucket: string, object: string): string {
  return `${apiBase}/${bucket}/${object.split("/").map(encodeURIComponent).join("/")}`;
}

/** RFC 3986, the only encoding a canonical request accepts: encodeURIComponent leaves !'()* alone. */
function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * A V4 signed GET, minted on the spot. The bucket stays private — every object
 * is client material — and a bot on any machine can still fetch the file with
 * plain HTTP, because the signature carries the permission and an expiry.
 */
export function signedObjectUrl(config: AttachmentBucketConfig, object: string, at = Date.now()): string {
  const host = new URL(config.apiBase).host;
  const path = `/${config.bucket}/${object.split("/").map(rfc3986).join("/")}`;
  const iso = new Date(at).toISOString();
  const stamp = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  const scope = `${stamp.slice(0, 8)}/auto/storage/goog4_request`;
  const query = [
    ["X-Goog-Algorithm", "GOOG4-RSA-SHA256"],
    ["X-Goog-Credential", `${config.credentials.client_email}/${scope}`],
    ["X-Goog-Date", stamp],
    ["X-Goog-Expires", String(SIGNED_URL_LIFETIME_SECONDS)],
    ["X-Goog-SignedHeaders", "host"],
  ]
    .sort(([a], [b]) => (a! < b! ? -1 : 1))
    .map(([name, value]) => `${rfc3986(name!)}=${rfc3986(value!)}`)
    .join("&");
  const canonical = ["GET", path, query, `host:${host}`, "", "host", "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["GOOG4-RSA-SHA256", stamp, scope, createHash("sha256").update(canonical).digest("hex")].join("\n");
  const signature = createSign("RSA-SHA256").update(stringToSign).sign(config.credentials.private_key, "hex");
  return `${config.apiBase}${path}?${query}&X-Goog-Signature=${signature}`;
}

function recordPath(name: string): string {
  return join(BUCKET_RECORDS_DIR, `${name}.json`);
}

/** What the bucket holds for this attachment name, or null when it was never archived. */
export function archivedAttachment(name: string): ArchivedAttachment | null {
  if (!/^[\w.-]+$/.test(name)) return null;
  try {
    const raw = readFileSync(recordPath(name), "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const object = typeof parsed.object === "string" ? parsed.object : "";
    const url = typeof parsed.url === "string" ? parsed.url : "";
    const bucket = typeof parsed.bucket === "string" ? parsed.bucket : "";
    const at = typeof parsed.at === "number" ? parsed.at : 0;
    return object && url && bucket ? { bucket, object, url, at } : null;
  } catch {
    return null;
  }
}

function remember(name: string, record: ArchivedAttachment): void {
  mkdirSync(BUCKET_RECORDS_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(recordPath(name), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/**
 * Uploads one committed attachment and remembers its URL. Never throws: an
 * archive failure must not fail the upload, which already reached the disk.
 */
export async function archiveAttachment(
  path: string,
  options: { config?: AttachmentBucketConfig | null; fetchImpl?: FetchLike; now?: number } = {},
): Promise<ArchivedAttachment | null> {
  const config = options.config === undefined ? attachmentBucketConfig() : options.config;
  if (!config) return null;
  const name = basename(path);
  const fetchImpl = options.fetchImpl ?? fetch;
  const at = options.now ?? Date.now();
  try {
    const bytes = readFileSync(path);
    const object = bucketObjectName(config.prefix, name, at);
    const token = await accessToken(config, fetchImpl, at);
    const response = await fetchImpl(
      `${config.apiBase}/upload/storage/v1/b/${encodeURIComponent(config.bucket)}/o?uploadType=media&name=${encodeURIComponent(object)}`,
      { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: bytes },
    );
    if (!response.ok) throw new Error(`GCS upload answered ${response.status}`);
    const record: ArchivedAttachment = { bucket: config.bucket, object, url: objectUrl(config.apiBase, config.bucket, object), at };
    remember(name, record);
    return record;
  } catch (error) {
    console.warn(`attachment ${name} was not archived: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

const ATTACHMENT_TAG = /^[\t ]*<attached-(image|file)[\t ]+path="([^"\r\n]*)"(?:[\t ]+name="([^"\r\n]*)")?[\t ]*\/>[\t ]*$/;

/**
 * Every attachment tag in the turn text whose file is archived, as one block of
 * URLs. A bot on another computer cannot open `path`; it can always fetch a URL.
 */
export function bucketReferenceBlock(
  text: string,
  options: { config?: AttachmentBucketConfig | null; now?: number } = {},
): string {
  const config = options.config === undefined ? attachmentBucketConfig() : options.config;
  const lines: string[] = [];
  for (const line of text.split("\n")) {
    const match = ATTACHMENT_TAG.exec(line);
    if (!match) continue;
    const path = decodeAttachmentAttribute(match[2]!);
    const record = archivedAttachment(basename(path));
    if (!record) continue;
    const label = match[3] ? decodeAttachmentAttribute(match[3]) : basename(path);
    lines.push(`- ${label}: ${config ? signedObjectUrl(config, record.object, options.now) : record.url}`);
  }
  if (!lines.length) return "";
  return ["Attachments also stored outside this machine (fetch these URLs if the paths above do not exist here):", ...lines].join("\n");
}

/** Test seam: the token cache would otherwise outlive a changed service account. */
export function __resetBucketTokensForTests(): void {
  tokens.clear();
}

/** Exported for the route hook's tests. */
export const attachmentBucketEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => attachmentBucketConfig(env) !== null;
