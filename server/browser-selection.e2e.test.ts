import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer } from "../scripts/control-omb.ts";

it("keeps browser routing until restart and applies engine changes when a pending browser choice is cancelled", async () => {
  const fixture = await launchVerificationServer();
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const save = async (browser: "auto" | "brave", engine: "chrome" | "agent-browser") => {
    const body = { browserEngine: { browser, engine } };
    const response = await fetch(`${fixture.info.url}/api/config`, {
      method: "PATCH", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(body),
    });
    const result = await response.json() as { browserEngine: { browser: string; engine: string; restartRequired: boolean } };
    evidence.push({ command: { method: "PATCH", path: "/api/config", body }, status: response.status, browserEngine: result.browserEngine });
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result.browserEngine;
  };
  try {
    expect(await save("brave", "chrome")).toMatchObject({ browser: "brave", engine: "agent-browser", restartRequired: true });
    expect(await save("auto", "chrome")).toMatchObject({ browser: "auto", engine: "chrome", restartRequired: false });
    expect(await save("brave", "chrome")).toMatchObject({ browser: "brave", engine: "chrome", restartRequired: true });
    expect(await save("auto", "agent-browser")).toMatchObject({ browser: "auto", engine: "agent-browser", restartRequired: false });
  } finally {
    writeFileSync(`${fixture.info.logPath}.browser-selection.json`, JSON.stringify(evidence, null, 2));
    console.log(`Browser selection evidence: ${fixture.info.logPath}.browser-selection.json`);
    await fixture.close();
  }
}, 60_000);
