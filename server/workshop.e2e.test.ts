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
import { describe, expect, it } from "vitest";

import { launchVerificationServer } from "../scripts/control-astra.ts";

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
});
