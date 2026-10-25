// Against the real server: Twilio's webhook reaches MausBot, MausBot hands the job to the department's Chief of Staff,
// the Chief to a specialist, and every reply MausBot gives goes back out through a stand-in for Twilio's API.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { expect, it } from "vitest";

import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { request } from "../scripts/mcp-server.ts";
import { twilioSignature } from "./whatsapp/twilio.ts";

const SID = "AC" + "3".repeat(32);
const TOKEN = "e2e-auth-token";
const ME = "+14155550100";

it("routes a WhatsApp request through MausBot to the right Chief of Staff and replies on WhatsApp", async () => {
  const sent: Array<{ to: string; body: string }> = [];
  const twilio = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const form = new URLSearchParams(raw);
      sent.push({ to: form.get("To") ?? "", body: form.get("Body") ?? "" });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ sid: `SM${sent.length}` }));
    });
  });
  await new Promise<void>((resolve) => twilio.listen(0, "127.0.0.1", resolve));
  const twilioBase = `http://127.0.0.1:${(twilio.address() as AddressInfo).port}`;

  const session = await launchVerificationServer({ ...process.env, OMB_TWILIO_API_BASE: twilioBase }, undefined, undefined, undefined, undefined, { scripted: true });
  const cli = (...args: string[]) => runControlOmb(args, { env: { OPENMAUSBOT_URL: session.info.url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, session.info.url) as Promise<any>;
  try {
    const maus = (await api("/api/bots")).bots.find((bot: any) => bot.defaultBot);
    expect(maus, "the fixture has a MausBot").toBeTruthy();
    const chief = (await cli("new-bot", "--name", "Mira", "--section", "Marketing")).bot;
    const writer = (await cli("new-bot", "--name", "Copywriter", "--section", "Marketing")).bot;
    await api(`/api/bots/${chief.id}`, { chiefOfStaff: true }, "PATCH");
    // The owner lets MausBot coordinate Marketing (its settings → Access → Additional departments).
    await api(`/api/bots/${maus.id}`, { chiefOfStaff: true, managedSections: ["Marketing"], acknowledgePeerScope: true }, "PATCH");

    const planPath = join(session.info.dataDir, "room-plan.json");
    writeFileSync(planPath, JSON.stringify({
      [maus.id]: { steps: [{ arguments: { bot_ids: [chief.id], message: "Draft the launch post for Friday" } }], reply: "On it: Mira, the **Marketing** Chief of Staff, has it.", resumeReply: "Done: the launch post is drafted and reviewed." },
      [chief.id]: { steps: [{ arguments: { bot_ids: [writer.id], message: "Write the Friday launch post" } }], reply: "Sent to Copywriter", resumeReply: "Launch post drafted and reviewed" },
      [writer.id]: { reply: "Draft written" },
    }));

    const settings = await api("/api/whatsapp", { accountSid: SID, authToken: TOKEN, allowed: [ME], enabled: true }, "PUT");
    expect(settings).toMatchObject({ enabled: true, hasToken: true, allowed: [ME] });
    const webhookUrl = settings.webhookUrl as string;

    const form = { From: `whatsapp:${ME}`, To: "whatsapp:+14155238886", Body: "Get a launch post written for Friday", MessageSid: "SMe2e1", NumMedia: "0" };
    const forged = await fetch(webhookUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": "forged" }, body: new URLSearchParams(form).toString() });
    expect(forged.status).toBe(403);
    const delivered = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "x-twilio-signature": twilioSignature(webhookUrl, form, TOKEN) },
      body: new URLSearchParams(form).toString(),
    });
    expect(delivered.status).toBe(200);

    await expect.poll(() => sent.map((entry) => entry.body), { timeout: 45_000, interval: 250 }).toEqual([
      "On it: Mira, the *Marketing* Chief of Staff, has it.",
      "Done: the launch post is drafted and reviewed.",
    ]);
    expect(sent.every((entry) => entry.to === `whatsapp:${ME}`)).toBe(true);

    const evidence = readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(evidence.map((turn: any) => turn.botId)).toEqual([maus.id, chief.id, writer.id, chief.id, maus.id]);
    const thread = (await api("/api/bots")).bots.find((bot: any) => bot.id === maus.id).tasks.find((task: any) => task.title === "WhatsApp");
    expect(thread, "MausBot has a WhatsApp thread").toBeTruthy();
    const said = (await api(`/api/threads/${thread.threadId}/messages`)).messages;
    expect(said.find((message: any) => message.role === "user")?.text).toBe("Get a launch post written for Friday");
    expect(existsSync(join(session.info.dataDir, "whatsapp.json"))).toBe(true);
    expect(readFileSync(join(session.info.dataDir, "whatsapp.json"), "utf8")).not.toContain(TOKEN);
  } finally {
    await session.close();
    await new Promise((resolve) => twilio.close(resolve));
  }
}, 120_000);
