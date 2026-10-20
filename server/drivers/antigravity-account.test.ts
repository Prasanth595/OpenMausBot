import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { antigravityQuota } from "./antigravity-account.ts";

const dirs: string[] = [];
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

it("reads Antigravity quota buckets without exposing credentials", async () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-antigravity-quota-")); dirs.push(dir);
  const token = join(dir, "acp_token.json");
  writeFileSync(token, JSON.stringify({ client_id: "id", client_secret: "secret", refresh_token: "refresh" }), { mode: 0o600 });
  const fetch = vi.fn()
    .mockResolvedValueOnce(Response.json({ access_token: "access" }))
    .mockResolvedValueOnce(Response.json({ groups: [{ displayName: "Gemini", buckets: [{ displayName: "5-hour", remainingFraction: 0.8, resetTime: "2026-10-20T10:00:00Z" }] }] }));
  vi.stubGlobal("fetch", fetch);
  await expect(antigravityQuota(token)).resolves.toEqual({ groups: [{ name: "Gemini", buckets: [{ name: "5-hour", remainingPercent: 80, resetsAt: "2026-10-20T10:00:00Z" }] }] });
  expect(String(fetch.mock.calls[1]?.[1]?.headers?.Authorization)).toBe("Bearer access");
});
