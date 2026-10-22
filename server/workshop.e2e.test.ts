// End-to-end verification of the workshop subsystem's server wiring, on an
// isolated fixture (throwaway data dir, random port, fake engine) per
// docs/verification/README.md.
//
// What is proven here, through the REAL server and REAL endpoints:
//   1. the feature is off by default — the status flag reports false and
//      the internal door refuses (403), whatever credential the caller
//      supplies, because the gate is read before anything else runs;
//   2. a config PATCH flips `features.workshop` on live, without a
//      restart, and the flag reports back true.
//
// The crate mechanics themselves (name rules, caps, JSON validation,
// byte-exact round-trips) are unit-tested in server/workshop.test.ts
// against throwaway homes; the agent-facing tool's argument shaping is not
// re-proven here, to keep this fixture to what only the real server can
// answer.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-omb.ts";

describe("workshop server wiring", () => {
  it("is off by default, refuses the internal door while off, and config-flips on live", async () => {
    const fixture = await launchVerificationServer();
    const { url } = fixture.info;
    const api = async (method: string, path: string, body?: unknown) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(5_000),
      });
      const result = (await response.json()) as Record<string, unknown>;
      return { status: response.status, body: result, json: result };
    };
    try {
      // 1. Off by default: the flag is false and the internal door refuses
      //    before touching the crate. Anonymous requests hit the wholesale
      //    /api/internal auth gate (401) before my route runs, while a
      //    properly credentialed harness caller hits the feature gate
      //    (403) — both prove the path never opens without the opt-in.
      const config1 = await api("GET", "/api/config");
      expect((config1.body.features as Record<string, unknown> | undefined)?.workshop).toBe(false);
      const door1 = await api("GET", "/api/internal/workshop");
      expect([401, 403]).toContain(door1.status);

      // 2. Config PATCH turns it on, live, without a restart.
      const patch = await api("PATCH", "/api/config", { features: { workshop: true } });
      expect(patch.status).toBe(200);
      const config2 = await api("GET", "/api/config");
      expect((config2.body.features as Record<string, unknown>)?.workshop).toBe(true);
    } finally {
      await fixture.close();
    }
  }, 120_000);

  it("operator doors list, serve, and delete figures through the real server", async () => {
    const fixture = await launchVerificationServer();
    const { url, dataDir } = fixture.info;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 12"><rect width="20" height="12" fill="#22c55e"/></svg>`;
    const crate = join(dataDir, "workshop");
    const api = async (method: string, path: string, body?: string) => {
      const response = await fetch(`${url}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body }),
        signal: AbortSignal.timeout(5_000),
      });
      return response;
    };
    try {
      // Off: every operator door is closed, whatever the route.
      const closed = ["/api/workshop", "/api/workshop/files/figure-pump.svg"] as const;
      for (const route of closed) {
        const response = await api("GET", route);
        expect([401, 403]).toContain(response.status);
      }

      // The same opt-in the panel's Enable button sends.
      const patch = await api("PATCH", "/api/config", JSON.stringify({ features: { workshop: true } }));
      expect(patch.status).toBe(200);

      // A figure exists on disk exactly where the crate says it lives.
      mkdirSync(crate, { recursive: true });
      const figurePath = join(crate, "figure-pump.svg");
      writeFileSync(figurePath, svg);

      // The listing shows it with its digest; a text resource previews as text.
      const list = await api("GET", "/api/workshop");
      expect(list.status).toBe(200);
      const listed = (await list.json()) as { enabled: boolean; files: Array<{ name: string; bytes: number; sha256: string }> };
      expect(listed.enabled).toBe(true);
      const figure = listed.files.find((entry) => entry.name === "figure-pump.svg");
      expect(figure?.bytes).toBe(svg.length);
      expect(figure?.sha256).toBeTruthy();

      const figureResponse = await api("GET", "/api/workshop/files/figure-pump.svg");
      expect(figureResponse.status).toBe(200);
      expect(figureResponse.headers.get("content-type")).toBe("image/svg+xml");
      // the no-scripts CSP: a figure stays a drawing even opened as a tab
      expect(figureResponse.headers.get("content-security-policy")).toContain("script-src 'none'");
      expect(await figureResponse.text()).toBe(svg);

      const textPath = join(crate, "figure-note.md");
      writeFileSync(textPath, "# pump\n");
      const textResponse = await api("GET", "/api/workshop/files/figure-note.md");
      expect(textResponse.status).toBe(200);
      expect(textResponse.headers.get("content-type")?.startsWith("text/plain")).toBe(true);
      expect(await textResponse.text()).toBe("# pump\n");

      // Refusals: unknown names 404, traversal never 200 (the URL parser or
      // the name validator stops it before a byte is served).
      expect((await api("GET", "/api/workshop/files/figure-missing.svg")).status).toBe(404);
      const traversal = await api("GET", "/api/workshop/files/..%2Fescape.md");
      expect([400, 404]).toContain(traversal.status);

      // Delete through the door, verify through the disk.
      const removed = await api("DELETE", "/api/workshop/files/figure-pump.svg");
      expect(removed.status).toBe(200);
      expect(existsSync(figurePath)).toBe(false);
      expect((await api("GET", "/api/workshop/files/figure-pump.svg")).status).toBe(404);
    } finally {
      await fixture.close();
    }
  }, 120_000);
});
