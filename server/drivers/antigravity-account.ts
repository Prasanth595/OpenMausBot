import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

type Identity = { email: string; method: "login" } | undefined;
type Credentials = { client_id: string; client_secret: string; refresh_token: string };
export interface AntigravityQuotaBucket { name: string; remainingPercent: number; resetsAt: string | null }
export interface AntigravityQuota { groups: Array<{ name: string; buckets: AntigravityQuotaBucket[] }> }
const identities = new Map<string, { fingerprint: string; expires: number; result: Promise<Identity> }>();

/** The official ACP file stores refresh credentials, not the account email.
 * Resolve display identity through Google only; never expose or rewrite tokens. */
export async function antigravityAccount(tokenPath: string): Promise<Identity> {
  try {
    const info = await stat(tokenPath);
    if (!info.isFile() || info.size > 1024 * 1024) return undefined;
    const raw = await readFile(tokenPath, "utf8");
    const fingerprint = createHash("sha256").update(raw).digest("hex");
    const cached = identities.get(tokenPath);
    if (cached?.fingerprint === fingerprint && cached.expires > Date.now()) return cached.result;
    const credentials = credentialsOf(raw);
    if (!credentials) return undefined;
    const entry = { fingerprint, expires: Date.now() + 60_000, result: Promise.resolve<Identity>(undefined) };
    entry.result = lookup(credentials).then((account) => {
      if (account) entry.expires = Date.now() + 60 * 60_000;
      return account;
    });
    if (identities.size >= 128) identities.delete(identities.keys().next().value!);
    identities.set(tokenPath, entry);
    return entry.result;
  } catch {
    identities.delete(tokenPath);
    return undefined;
  }
}

export async function antigravityQuota(tokenPath: string): Promise<AntigravityQuota | null> {
  try {
    const info = await stat(tokenPath);
    if (!info.isFile() || info.size > 1024 * 1024) return null;
    const credentials = credentialsOf(await readFile(tokenPath, "utf8"));
    if (!credentials) return null;
    const token = await accessToken(credentials);
    if (!token) return null;
    const response = await fetch("https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary", {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000), headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "antigravity/hub" }, body: "{}",
    });
    if (!response.ok) return null;
    const data = await response.json() as { groups?: unknown };
    if (!Array.isArray(data.groups)) return null;
    return { groups: data.groups.flatMap((group) => {
      if (!group || typeof group !== "object") return [];
      const row = group as { displayName?: unknown; buckets?: unknown };
      if (!Array.isArray(row.buckets)) return [];
      const buckets = row.buckets.flatMap((bucket) => {
        if (!bucket || typeof bucket !== "object") return [];
        const item = bucket as { displayName?: unknown; bucketId?: unknown; remainingFraction?: unknown; resetTime?: unknown };
        if (typeof item.remainingFraction !== "number" || !Number.isFinite(item.remainingFraction)) return [];
        return [{ name: typeof item.displayName === "string" ? item.displayName : typeof item.bucketId === "string" ? item.bucketId : "Quota", remainingPercent: Math.round(Math.max(0, Math.min(1, item.remainingFraction)) * 100), resetsAt: typeof item.resetTime === "string" ? item.resetTime : null }];
      });
      return buckets.length ? [{ name: typeof row.displayName === "string" ? row.displayName : "Antigravity", buckets }] : [];
    }) };
  } catch { return null; }
}

function credentialsOf(raw: string): Credentials | null {
  try {
    const value = JSON.parse(raw);
    return value && ["client_id", "client_secret", "refresh_token"].every((key) => typeof value[key] === "string" && value[key].length > 0) ? value : null;
  } catch { return null; }
}

async function accessToken(credentials: Credentials): Promise<string | null> {
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000), body: new URLSearchParams({ grant_type: "refresh_token", ...credentials }) });
    const value = await response.json() as { access_token?: unknown };
    return response.ok && typeof value.access_token === "string" && value.access_token ? value.access_token : null;
  } catch { return null; }
}

async function lookup(credentials: { client_id: string; client_secret: string; refresh_token: string }): Promise<Identity> {
  try {
    const signal = AbortSignal.timeout(3_000);
    const token = await accessToken(credentials);
    if (!token) return undefined;
    const identity = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal,
    });
    if (!identity.ok) return undefined;
    const user = await identity.json() as { email?: unknown };
    if (typeof user.email !== "string" || user.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)) return undefined;
    return { email: user.email, method: "login" };
  } catch {
    // Identity lookup failure must not mark a working engine as signed out.
    return undefined;
  }
}
