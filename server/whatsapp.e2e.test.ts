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

/** A stand-in for Twilio's REST API: it records sends, names the account and lists `inbox` as incoming messages. */
async function fakeTwilio() {
  const sent: Array<{ to: string; body: string }> = [];
  const inbox: Array<Record<string, string>> = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      res.writeHead(req.method === "POST" ? 201 : 200, { "content-type": "application/json" });
      if (req.method !== "POST") {
        res.end(JSON.stringify(req.url?.includes("/Messages.json") ? { messages: inbox } : { friendly_name: "Azad's Twilio" }));
        return;
      }
      const form = new URLSearchParams(raw);
      sent.push({ to: form.get("To") ?? "", body: form.get("Body") ?? "" });
      res.end(JSON.stringify({ sid: `SM${sent.length}` }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { sent, inbox, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

it("routes a WhatsApp request through MausBot to the right Chief of Staff and replies on WhatsApp", async () => {
  const fake = await fakeTwilio();
  const { sent } = fake;
  const twilioBase = fake.base;
  let session: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  try {

  session = await launchVerificationServer({ ...process.env, OMB_TWILIO_API_BASE: twilioBase }, undefined, undefined, undefined, undefined, { scripted: true });
  const url = session.info.url;
  const cli = (...args: string[]) => runControlOmb(args, { env: { OPENMAUSBOT_URL: url } }) as Promise<any>;
  const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, url) as Promise<any>;
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

    await api("/api/whatsapp/verify", { accountSid: SID, authToken: TOKEN });
    const settings = await api("/api/whatsapp", { allowed: [ME], enabled: true }, "PUT");
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
    await session?.close();
    await fake.close();
  }
}, 120_000);

it("sets up with no public address: checks Twilio, links the phone by code, then hears it by polling", async () => {
  const fake = await fakeTwilio();
  let session: Awaited<ReturnType<typeof launchVerificationServer>> | undefined;
  const row = (sid: string, body: string) => ({ sid, from: `whatsapp:${ME}`, to: "whatsapp:+14155238886", body, direction: "inbound", date_created: new Date(Date.now() + 1_000).toUTCString(), num_media: "0" });
  try {
    session = await launchVerificationServer({ ...process.env, OMB_TWILIO_API_BASE: fake.base }, undefined, undefined, undefined, undefined, { scripted: true });
    const url = session.info.url;
    const api = (path: string, body?: unknown, method = "POST") => request(path, body === undefined ? {} : { method, body: JSON.stringify(body) }, url) as Promise<any>;
    const maus = (await api("/api/bots")).bots.find((bot: any) => bot.defaultBot);
    writeFileSync(join(session.info.dataDir, "room-plan.json"), JSON.stringify({ [maus.id]: { reply: "Here is your week: three meetings and one deadline." } }));
    const checked = await api("/api/whatsapp/verify", { accountSid: SID, authToken: TOKEN });
    expect(checked).toMatchObject({ accountName: "Azad's Twilio", mode: "polling", sandbox: true, enabled: false });
    const { code } = await api("/api/whatsapp/link", {});
    expect(code).toMatch(/^\d{6}$/);

    fake.inbox.push(row("SMpoll1", `link ${code}`));
    await expect.poll(() => fake.sent.map((entry) => entry.body), { timeout: 20_000, interval: 250 })
      .toEqual([expect.stringContaining("You're connected.")]);
    expect(await api("/api/whatsapp")).toMatchObject({ enabled: true, allowed: [ME], linked: ["+1 415 ••• 0100"] });

    fake.inbox.push(row("SMpoll2", "What does my week look like?"));
    await expect.poll(() => fake.sent.map((entry) => entry.body), { timeout: 30_000, interval: 250 })
      .toEqual([expect.stringContaining("You're connected."), "Here is your week: three meetings and one deadline."]);
    expect(fake.sent.every((entry) => entry.to === `whatsapp:${ME}`)).toBe(true);
  } finally {
    await session?.close();
    await fake.close();
  }
}, 120_000);
