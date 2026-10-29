import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";

it("sends each router its own key and exact custom model ID without catalog discovery", async () => {
  const requests: Array<{ path: string; authorization: string | undefined; model: string }> = [];
  const upstream = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    requests.push({ path: req.url!, authorization: req.headers.authorization, model: body ? JSON.parse(body).model : "" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "Custom router replied." }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const address = upstream.address();
  if (!address || typeof address === "string") throw new Error("Missing router port");
  const fixture = await launchVerificationServer().catch((error) => { upstream.close(); throw error; });
  const evidence: unknown[] = [{ fixture: fixture.info }];
  const api = async (path: string, body: unknown) => {
    const response = await fetch(fixture.info.url + path, { method: "POST", headers: { "content-type": "application/json", origin: fixture.info.url }, body: JSON.stringify(body) });
    const result = await response.json() as any;
    expect(response.ok, JSON.stringify(result)).toBe(true);
    return result;
  };
  const control = async (args: string[]) => {
    const result = await runControlOmb([...args, "--url", fixture.info.url]) as any;
    evidence.push({ command: args, result });
    return result;
  };
  try {
    for (const [router, model] of [["one", "Acme/My Model:v2"], ["two", "My-CUSTOM/Model-2026"]]) {
      const added = await api("/api/instances/openai-compat", { displayName: `Router ${router}`, url: `http://127.0.0.1:${address.port}/${router}/v1`, key: `synthetic-${router}`, models: [model] });
      const instance = added.instances.find((item: any) => item.instanceId === added.instanceId);
      expect(instance.models.options.map((item: any) => item.id)).toEqual([model]);
      const { bot } = await control(["new-bot", "--name", `Router ${router}`]);
      await control(["set-model", "--bot", bot.id, "--instance", added.instanceId, "--model", model]);
      expect((await control(["send", "--bot", bot.id, "--text", "hello"])).success).toBe(true);
      const result = await control(["wait", "--bot", bot.id, "--timeout", "20"]);
      expect(result.status).toBe("settled");
      const messages = await control(["messages", "--bot", bot.id, "--limit", "10"]);
      expect(messages.messages.some((message: any) => message.text === "Custom router replied.")).toBe(true);
    }
    expect(requests).toEqual([
      { path: "/one/v1/chat/completions", authorization: "Bearer synthetic-one", model: "Acme/My Model:v2" },
      { path: "/two/v1/chat/completions", authorization: "Bearer synthetic-two", model: "My-CUSTOM/Model-2026" },
    ]);
  } finally {
    writeFileSync(`${fixture.info.logPath}.custom-router.json`, JSON.stringify(evidence, null, 2));
    console.log(`Custom router evidence: ${fixture.info.logPath}.custom-router.json`);
    await fixture.close();
    upstream.closeAllConnections();
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }
}, 90_000);
