import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("../skill-fetch.ts", async (original) => {
  const actual = await original<typeof import("../skill-fetch.ts")>();
  return { ...actual, fetchSkillFromSource: vi.fn(actual.fetchSkillFromSource) };
});

process.env.OMB_DATA_DIR = mkdtempSync(join(tmpdir(), "omb-global-skills-routes-"));
const { createGlobalSkillsRoutes } = await import("./global-skills.ts");
const { dispatchRoutes } = await import("./table.ts");
const { json, readBody } = await import("../harness/http.ts");
const library = await import("../skill-library.ts");
const { fetchSkillFromSource } = await import("../skill-fetch.ts");
import type { Store } from "../store.ts";
import type { RequestAuth } from "../request-auth.ts";

it("creates, reads, disables and unshares a skill while protecting library copies", async () => {
  const route = createGlobalSkillsRoutes({ store: { bots: [] } as unknown as Store });
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes([route], { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const send = (method: string, body: unknown) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const content = "---\nname: route-test\ndescription: Test skill\n---\nTest instructions.\n";
  try {
    const created = await fetch(`${base}/api/global-skills`, send("POST", { text: content, enabled: true }));
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ skills: [{ name: "route-test", global: true, enabled: true }] });
    expect(await (await fetch(`${base}/api/global-skills/route-test`)).json()).toEqual({ text: content });
    expect((await fetch(`${base}/api/global-skills/route-test`, send("PATCH", { enabled: false }))).status).toBe(200);
    const entry = library.listLibrarySkills().find((skill) => skill.name === "route-test")!;
    expect(entry).toMatchObject({ global: true, enabled: false });
    expect((await fetch(`${base}/api/global-skills/route-test`, send("DELETE", { sha256: "0".repeat(64) }))).status).toBe(409);
    expect((await fetch(`${base}/api/global-skills/route-test`, send("DELETE", { sha256: entry.sha256 }))).status).toBe(200);
    expect(library.readLibrarySkillFile("route-test")).toBe(content);
    expect((await fetch(`${base}/api/global-skills/route-test`, send("PATCH", { enabled: true }))).status).toBe(404);
    expect((await fetch(`${base}/api/global-skills`, send("POST", { source: "invalid" }))).status).toBe(422);
    vi.mocked(fetchSkillFromSource).mockResolvedValueOnce({ skills: [
      { source: "fixture", files: [{ path: "SKILL.md", content: "---\nname: valid-first\ndescription: Test\n---\nInstructions" }] },
      { source: "fixture", files: [{ path: "SKILL.md", content: "invalid" }] },
    ] });
    expect((await fetch(`${base}/api/global-skills`, send("POST", { source: "fixture/repo" }))).status).toBe(422);
    expect(library.listLibrarySkills().some((skill) => skill.name === "valid-first")).toBe(false);

    vi.mocked(fetchSkillFromSource).mockResolvedValueOnce({ skills: [
      { source: "fixture", files: [{ path: "SKILL.md", content: "---\nname: valid-first\ndescription: Test\n---\nInstructions" }] },
      { source: "fixture", files: [{ path: "SKILL.md", content: content.replace("Test instructions.", "Different instructions.") }] },
    ] });
    expect((await fetch(`${base}/api/global-skills`, send("POST", { source: "fixture/repo" }))).status).toBe(422);
    expect(library.listLibrarySkills().some((skill) => skill.name === "valid-first")).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
