import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

// The desktop app runs with the result contract on (server/result-contract.ts):
// a routine run that ends without a proved RESULTADO is not completed.
it("with the result contract on, a routine run completes only on a declared, proved RESULTADO", async () => {
  const state = join(mkdtempSync(join(tmpdir(), "omb-result-contract-")), "replies");
  const fixture = await launchVerificationServer({
    ...process.env,
    OMB_RESULT_CONTRACT: "1",
    FAKE_CLAUDE_REPLY_STATE: state,
    FAKE_CLAUDE_REPLIES: JSON.stringify([
      "Terminei a revisão do Sentry.",
      "Revisei o Sentry.\nRESULTADO: feito — comentei https://github.com/o/r/issues/1#issuecomment-2",
    ]),
  });
  const api = async (method: string, path: string, body?: unknown, status = 200) => {
    const response = await fetch(`${fixture.info.url}${path}`, {
      method, headers: { "content-type": "application/json", origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const value = await response.json() as any;
    expect(response.status, `${method} ${path}: ${JSON.stringify(value)}`).toBe(status);
    return value;
  };
  const runState = async (id: string) => (await api("GET", "/api/routines")).runs.find((run: any) => run.id === id);
  try {
    const { bot } = await runControlOmb(["new-bot", "--name", "Contrato", "--url", fixture.info.url]) as any;
    const { routine } = await api("POST", "/api/routines", {
      name: "Revisão do Sentry", prompt: "Revise o Sentry.", botId: bot.id, enabled: false,
      schedule: { type: "interval", everyMinutes: 60, anchorAt: Date.now() + 3_600_000 },
    }, 201);
    const first = (await api("POST", `/api/routines/${routine.id}/run`, undefined, 201)).run;
    await expect.poll(async () => (await runState(first.id))?.status, { timeout: 20_000 }).toBe("failed");
    expect((await runState(first.id)).error).toBe("Resultado não verificado: a resposta não terminou com a linha RESULTADO");
    // the run's prompt asked for the line
    expect(JSON.stringify(JSON.parse(readFileSync(fixture.fixtureDumpPath, "utf8")).prompt)).toContain("RESULTADO: feito");
    const second = (await api("POST", `/api/routines/${routine.id}/run`, undefined, 201)).run;
    await expect.poll(async () => (await runState(second.id))?.status, { timeout: 20_000 }).toBe("completed");
  } finally {
    await fixture.close();
  }
}, 90_000);
