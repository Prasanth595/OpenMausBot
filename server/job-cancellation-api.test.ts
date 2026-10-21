import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { readHandoffs } from "./testing/handoff-rows.ts";
import { agentBrowser, ensureUiBrowser, sessionEnv } from "../scripts/testing/control-omb-ui.ts";
import { mountPreview, type MountedPreview } from "../scripts/testing/preview-fixture.ts";

it("paired Chief cancellation stops the exact native job after ordinary Stop left a running hand-off", async () => {
  const fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  const evidence: unknown[] = [];
  const api = async (method: string, path: string, body?: unknown, token?: string) => {
    const response = await fetch(`${fixture.info.url}${path}`, { method,
      headers: { "content-type": "application/json", origin: fixture.info.url, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = { status: response.status, body: await response.json() as any };
    evidence.push(path.startsWith("/api/auth/") ? { method, path, status: result.status } : { method, path, body, result });
    return result;
  };
  const cli = (...args: string[]) => runControlOmb([...args, "--url", fixture.info.url]) as Promise<any>;
  const rows = () => readHandoffs(fixture.info.dataDir);
  let preview: MountedPreview | undefined;
  let browser: { binary: string; env: NodeJS.ProcessEnv } | undefined;
  try {
    const chief = (await cli("new-bot", "--name", "Cancellation Chief", "--section", "Leadership")).bot;
    const expert = (await cli("new-bot", "--name", "Cancellation Expert", "--section", "Engineering")).bot;
    expect((await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: true, managedSections: ["Engineering"], acknowledgePeerScope: true })).status).toBe(200);
    const plan: Record<string, unknown> = {
      [chief.id]: { steps: [{ arguments: { bot_ids: [expert.id], message: "Hold this exact job for cancellation" } }], reply: "Assigned", resumeReply: "MUST_NOT_RESUME_CANCELLED_JOB" },
      [expert.id]: { gateFile: join(fixture.info.dataDir, "expert-finish-gate"), reply: "Useful partial report" },
    };
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify(plan));
    await cli("send", "--bot", chief.id, "--task", chief.activeTaskId, "--text", "Assign the exact cancellation fixture job");
    await expect.poll(() => rows().some(row => row.parentId && row.status === "running"), { timeout: 20_000 }).toBe(true);
    const child = rows().find(row => row.parentId && row.status === "running")!;
    const root = rows().find(row => row.id === child.rootId)!;
    const invitation = await api("POST", "/api/auth/pairing", { label: "Chief cancellation fixture", scopes: ["client"] });
    const accepted = await api("POST", "/api/auth/pair", { code: invitation.body.code, label: "Paired Chief fixture" });
    expect(accepted.status).toBe(200);
    let token = accepted.body.token;
    const base = `/api/bots/${chief.id}/jobs/${root.id}`;
    expect((await api("GET", `/api/bots/${expert.id}/jobs/${root.id}/cancellation`, undefined, token)).status).toBe(404);
    expect((await api("POST", `/api/bots/${chief.id}/interrupt`, { threadId: root.threadId }, token)).status).toBe(200);
    expect(rows().find(row => row.id === child.id)?.status).toBe("running");
    const newerGate = join(fixture.info.dataDir, "newer-chief-finish-gate");
    plan[chief.id] = { gateFile: newerGate, reply: "NEWER_CHIEF_REQUEST_FINISHED" };
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify(plan));
    await cli("send", "--bot", chief.id, "--task", root.threadId, "--text", "Keep this newer independent request running");
    await expect.poll(() => rows().some(row => !row.parentId && row.id !== root.id && row.botId === chief.id && row.status === "source"), { timeout: 15_000 }).toBe(true);
    const newer = rows().find(row => !row.parentId && row.id !== root.id && row.botId === chief.id && row.status === "source")!;
    const snapshot = await api("GET", `${base}/cancellation`, undefined, token);
    expect(snapshot.status).toBe(200);
    expect(snapshot.body).toMatchObject({ rootId: root.id, sourceBotId: chief.id, sourceThreadId: root.threadId, generation: root.id });
    expect((await api("POST", `${base}/cancel`, { ...snapshot.body, unexpected: true }, token)).status).toBe(400);
    expect(rows().find(row => row.id === child.id)?.status).toBe("running");
    expect((await api("POST", "/api/auth/logout", {}, token)).status).toBe(200);
    expect((await api("POST", `${base}/cancel`, snapshot.body, token)).status).toBe(401);
    expect(rows().find(row => row.id === child.id)?.status).toBe("running");
    const replacementInvitation = await api("POST", "/api/auth/pairing", { label: "Replacement fixture session", scopes: ["client"] });
    const replacementSession = await api("POST", "/api/auth/pair", { code: replacementInvitation.body.code, label: "Replacement fixture client" });
    expect(replacementSession.status).toBe(200);
    token = replacementSession.body.token;
    const fresh = (await api("GET", `${base}/cancellation`, undefined, token)).body;
    if (process.env.OMB_UI_E2E === "1") {
      const tools = await ensureUiBrowser(process.env);
      preview = await mountPreview(fixture, { entry: "/scripts/testing/threads-preview.tsx", route: "/__job-cancellation.html",
        title: "Exact Chief job cancellation", logLevel: "silent", proxyHeaders: { authorization: `Bearer ${token}` } });
      browser = { binary: tools.binary, env: sessionEnv({ home: fixture.info.dataDir, session: `job-cancel-${process.pid}`, chrome: tools.chrome }) };
      if (process.env.OMB_UI_NO_SANDBOX === "1") browser.env.AGENT_BROWSER_ARGS = `${browser.env.AGENT_BROWSER_ARGS ?? ""}\n--no-sandbox`;
      const command = (...args: string[]) => agentBrowser(browser!.binary, browser!.env, args, 60_000);
      const evaluate = async (js: string) => (await command("eval", js)).result;
      await command("set", "viewport", "1280", "900");
      await command("open", preview.previewUrl);
      await expect.poll(() => evaluate(`(() => { const row = document.querySelector('[data-sidebar-bot-row="${chief.id}"]'); row?.click(); return Boolean(row); })()`), { timeout: 30_000 }).toBe(true);
      const label = "Cancel: Assign the exact cancellation fixture job";
      await expect.poll(() => evaluate(`Array.from(document.querySelectorAll('button')).some(button => button.textContent.trim() === ${JSON.stringify(label)})`), { timeout: 30_000 }).toBe(true);
      expect(await evaluate(`Boolean(document.querySelector('button[title="Stop this turn"]'))`)).toBe(true);
      await evaluate(`(() => { const nativeFetch = window.fetch.bind(window); window.officeCancelRequests = []; window.fetch = async (input, init) => {
        const response = await nativeFetch(input, init); if (String(input).includes('/jobs/')) window.officeCancelRequests.push({ path: String(input), method: init?.method ?? 'GET', status: response.status }); return response;
      }; return true; })()`);
      const beforePng = `${fixture.info.logPath}.chief-cancel-before.png`;
      await command("screenshot", beforePng);
      await command("find", "role", "button", "click", "--name", label, "--exact");
      await expect.poll(async () => (await api("GET", `/api/threads/${root.threadId}/messages?limit=100`)).body.messages
        .find((message: any) => message.id === fresh.requestMessageId)?.jobCancellation?.state, { timeout: 15_000 }).toBe("cancelled");
      const requests = await evaluate("window.officeCancelRequests");
      expect(requests).toEqual([{ path: `${base}/cancellation`, method: "GET", status: 200 }, { path: `${base}/cancel`, method: "POST", status: 200 }]);
      const afterPng = `${fixture.info.logPath}.chief-cancel-after.png`;
      await command("screenshot", afterPng);
      const consoleOutput = await command("console");
      expect(((consoleOutput.messages ?? []) as Array<{ type: string }>).filter(message => message.type === "error")).toEqual([]);
      evidence.push({ ui: { beforePng, afterPng, requests, console: consoleOutput } });
      console.info(JSON.stringify({ beforePng, afterPng }));
    } else {
      const cancelled = await api("POST", `${base}/cancel`, fresh, token);
      expect(cancelled).toMatchObject({ status: 200, body: { state: "cancelled", activeIds: [] } });
    }
    await expect.poll(() => rows().find(row => row.id === child.id)?.status, { timeout: 10_000 }).toBe("cancelled");
    await expect.poll(async () => {
      const inventory = (await api("GET", "/api/bots?messages=0")).body;
      return inventory.bots.find((bot: any) => bot.id === expert.id)?.tasks.find((task: any) => task.threadId === child.threadId)?.busy;
    }, { timeout: 10_000 }).toBe(false);
    expect((await api("POST", `${base}/cancel`, fresh, token)).body).toMatchObject({ state: "cancelled", alreadyCancelled: true });
    expect(rows().find(row => row.id === newer.id)?.status).toBe("source");
    writeFileSync(newerGate, "finish the newer fixture request");
    expect((await cli("wait", "--bot", chief.id, "--task", root.threadId, "--timeout", "15")).status).toBe("settled");
    const page = (await api("GET", `/api/threads/${root.threadId}/messages?limit=100`)).body;
    expect(page.messages.some((message: any) => message.text === "NEWER_CHIEF_REQUEST_FINISHED")).toBe(true);
    expect(page.messages.some((message: any) => message.text === "MUST_NOT_RESUME_CANCELLED_JOB")).toBe(false);
    expect(page.messages.filter((message: any) => message.roomRequest?.id === child.id && message.roomRequest.phase === "result")).toHaveLength(1);
    const source = page.messages.find((message: any) => message.id === fresh.requestMessageId);
    expect(source).toMatchObject({ requestCancelled: true, requestPending: false, jobCancellation: { rootId: root.id, state: "cancelled" } });

    plan[chief.id] = { steps: [{ arguments: { bot_ids: [expert.id], message: "Hold the job that the Chief will cancel with its tool" } }], reply: "Assigned another job" };
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify(plan));
    await cli("send", "--bot", chief.id, "--task", root.threadId, "--text", "Assign another bounded fixture job");
    await expect.poll(() => rows().some(row => row.parentId && row.id !== child.id && row.status === "running"), { timeout: 15_000 }).toBe(true);
    const toolChild = rows().find(row => row.parentId && row.id !== child.id && row.status === "running")!;
    await api("POST", `/api/bots/${chief.id}/interrupt`, { threadId: root.threadId }, token);
    expect(rows().find(row => row.id === toolChild.id)?.status).toBe("running");
    plan[chief.id] = { steps: [{ tool: "assignment_status", arguments: {} }, { tool: "cancel_job", arguments: { job_id: toolChild.rootId } }], reply: "NATURAL_CANCEL_TOOL_FINISHED" };
    writeFileSync(join(fixture.info.dataDir, "room-plan.json"), JSON.stringify(plan));
    await cli("send", "--bot", chief.id, "--task", root.threadId, "--text", "Cancel the earlier job, including its running hand-off");
    expect((await cli("wait", "--bot", chief.id, "--task", root.threadId, "--timeout", "15")).status).toBe("settled");
    expect(rows().find(row => row.id === toolChild.id)?.status).toBe("cancelled");
    const toolPage = (await api("GET", `/api/threads/${root.threadId}/messages?limit=100`)).body;
    expect(toolPage.messages.some((message: any) => message.text === "NATURAL_CANCEL_TOOL_FINISHED")).toBe(true);
    expect(toolPage.messages.some((message: any) => message.jobCancellation?.rootId === toolChild.rootId && message.jobCancellation.state === "cancelled")).toBe(true);
    evidence.push({ naturalChiefTool: { rootId: toolChild.rootId, childId: toolChild.id, status: rows().find(row => row.id === toolChild.id)?.status } });
  } finally {
    const evidencePath = `${fixture.info.logPath}.job-cancellation.json`;
    writeFileSync(evidencePath, JSON.stringify({ fixture: fixture.info, evidence, limitation: "Isolated HTTP/native runtime with fake providers only" }, null, 2));
    console.info(JSON.stringify({ evidencePath, logPath: fixture.info.logPath }));
    if (browser) await agentBrowser(browser.binary, browser.env, ["close"]).catch(() => {});
    await preview?.close();
    await fixture.close();
  }
}, process.env.OMB_UI_E2E === "1" ? 240_000 : 60_000);
