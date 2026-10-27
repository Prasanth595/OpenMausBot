import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";

import { signInOutcome, signInResumePrompt } from "../../shared/sign-in-request.ts";
import { savedLoginResumePrompt } from "../../shared/logins.ts";
import type { SignInRequestCardData } from "../../shared/wire.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { createSignInCardRoutes, type SignInCardRouteDeps, type SignInOutcome } from "./sign-in-cards.ts";
import { dispatchRoutes } from "./table.ts";

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function serve() {
  const settled: Array<{ botId: string; threadId: string; messageId: string; outcome: SignInOutcome }> = [];
  const saved: Array<{ botId: string; threadId: string; messageId: string; body: Record<string, unknown> }> = [];
  const targets: Array<{ botId: string; threadId: string; messageId: string }> = [];
  const routes = [createSignInCardRoutes({
    settle: (botId, threadId, messageId, outcome) => {
      settled.push({ botId, threadId, messageId, outcome });
      return messageId === "gone" ? { status: 404, body: { error: "no such sign-in request" } } : { status: 200, body: { resumed: true } };
    },
    saveLogin: async (botId, threadId, messageId, body) => {
      saved.push({ botId, threadId, messageId, body });
      return { status: 200, body: { done: true, resumed: true, saved: true, site: "example.com" } };
    },
    saveTarget: async (botId, threadId, messageId) => {
      targets.push({ botId, threadId, messageId });
      return { status: 200, body: { site: "example.com", signInHost: "login.microsoftonline.com" } };
    },
    threadVisible: (_auth, threadId) => threadId !== "hidden",
  })];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const auth = { kind: "loopback", scopes: ["admin"] } as unknown as RequestAuth;
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, type = "application/json") => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": type }, body: JSON.stringify(body) });
  return { base, settled, saved, targets, post };
}

function settlement() {
  const source = ts.createSourceFile("index.ts", readFileSync(new URL("../index.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === "settleSignIn");
  expect(declaration).toBeDefined();
  const code = ts.transpileModule(declaration!.getText(source), { compilerOptions: { target: ts.ScriptTarget.ESNext } }).outputText;
  let release!: () => void;
  const handingBack = new Promise<void>((resolve) => { release = resolve; });
  let message = { id: "m1", signIn: { site: "example.com", url: "https://example.com/login", place: "browser" } as SignInRequestCardData };
  const resume = vi.fn(() => true);
  const patch = vi.fn((_thread: string, _id: string, update: { signIn: SignInRequestCardData }) => { message = { ...message, ...update }; });
  const handBack = vi.fn(() => handingBack);
  const deps = {
    store: { bot: () => ({ id: "scout", browserProfile: "work" }), patchMessage: patch },
    signInMessage: () => message,
    browserLive: { handBack },
    currentBrowserSession: () => "profile-work",
    teamHost: { browserAudience: () => "team" },
    computerControl: { settleHelp: vi.fn(() => []), release: vi.fn() },
    botComputerControlKey: () => "scout",
    signInOutcome, signInResumePrompt, savedLoginResumePrompt,
    answerCardNode: resume,
  };
  const settle = new Function(...Object.keys(deps), `${code}; return settleSignIn;`)(...Object.values(deps)) as SignInCardRouteDeps["settle"];
  return { settle, release, handBack, resume, patch, card: () => message.signIn,
    supersede: () => { message = { ...message, signIn: { ...message.signIn, superseded: true } }; } };
}

describe("sign-in settlement in the server", () => {
  it("resumes and saves Done only after the browser hands control back", async () => {
    const { settle, release, handBack, resume, patch, card } = settlement();
    const answering = settle("scout", "t1", "m1", "done");
    expect(handBack).toHaveBeenCalledExactlyOnceWith("profile-work");
    await Promise.resolve();
    expect(resume).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    release();
    expect(await answering).toEqual({ status: 200, body: { done: true, resumed: true } });
    expect(resume).toHaveBeenCalledExactlyOnceWith("t1", "m1", signInResumePrompt("example.com", "done"));
    expect(card()).toMatchObject({ done: true, resumed: true });
  });

  it("does not resume a sign-in request superseded while browser control is returning", async () => {
    const { settle, release, resume, patch, supersede, card } = settlement();
    const answering = settle("scout", "t1", "m1", "done");
    supersede();
    release();
    expect(await answering).toEqual({ status: 409, body: { error: "this sign-in request was superseded by a newer one" } });
    expect(resume).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    expect(card()).toMatchObject({ superseded: true });
    expect(card().done).toBeUndefined();
  });
});

describe("sign-in card routes", () => {
  it("waits for control to return before responding that Done resumed the bot", async () => {
    let release!: () => void;
    const handingBack = new Promise<void>((resolve) => { release = resolve; });
    const reply = vi.fn();
    const route = createSignInCardRoutes({
      settle: async () => {
        await handingBack;
        return { status: 200, body: { done: true, resumed: true } };
      },
      saveLogin: async () => ({ status: 200, body: {} }),
      saveTarget: async () => ({ status: 200, body: {} }),
      threadVisible: () => true,
    });
    const url = new URL("http://localhost/api/bots/scout/sign-in-cards/m1/done");
    const answering = route({ req: {} as never, res: {} as never, url, path: url.pathname, method: "POST", auth: {} as never, json: reply, readBody: async () => ({ threadId: "t1" }) });
    await Promise.resolve();
    expect(reply).not.toHaveBeenCalled();
    release();
    await answering;
    expect(reply).toHaveBeenCalledWith({}, 200, { done: true, resumed: true });
  });

  it("settles Done and Cancel for the named bot, thread and card", async () => {
    const { settled, post } = await serve();
    const done = await post("/api/bots/scout/sign-in-cards/m1/done", { threadId: "t1" });
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ resumed: true });
    expect((await post("/api/bots/scout/sign-in-cards/m2/cancel", { threadId: "t2" })).status).toBe(200);
    expect(settled).toEqual([
      { botId: "scout", threadId: "t1", messageId: "m1", outcome: "done" },
      { botId: "scout", threadId: "t2", messageId: "m2", outcome: "cancelled" },
    ]);
  });

  it("passes the server's refusal through", async () => {
    const { post } = await serve();
    const gone = await post("/api/bots/scout/sign-in-cards/gone/done", { threadId: "t1" });
    expect(gone.status).toBe(404);
    expect(await gone.json()).toEqual({ error: "no such sign-in request" });
  });

  it("leaves other methods and paths to the next route", async () => {
    const { base, settled, targets, post } = await serve();
    expect(await (await fetch(`${base}/api/bots/scout/sign-in-cards/m1/done`)).json()).toEqual({ from: "inline routes" });
    expect(await (await fetch(`${base}/api/bots/scout/sign-in-cards/m1/save-login`, { method: "PUT" })).json()).toEqual({ from: "inline routes" });
    expect(targets).toEqual([]);
    expect(await (await post("/api/bots/scout/sign-in-cards/m1/open", { threadId: "t1" })).json()).toEqual({ from: "inline routes" });
    expect(settled).toEqual([]);
  });

  it("says where a login saved from the card would fill, before anything is saved", async () => {
    const { base, saved, targets } = await serve();
    const response = await fetch(`${base}/api/bots/scout/sign-in-cards/m1/save-login?threadId=t1`);
    expect(await response.json()).toEqual({ site: "example.com", signInHost: "login.microsoftonline.com" });
    expect(targets).toEqual([{ botId: "scout", threadId: "t1", messageId: "m1" }]);
    expect(saved).toEqual([]);
  });

  it("saves a login for the card and answers with the site only, never the password", async () => {
    const { saved, settled, post } = await serve();
    const response = await post("/api/bots/scout/sign-in-cards/m1/save-login", { threadId: "t1", username: "alice", password: "fake-card-pass" });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ done: true, resumed: true, saved: true, site: "example.com" });
    expect(text).not.toContain("fake-card-pass");
    expect(saved).toEqual([{ botId: "scout", threadId: "t1", messageId: "m1", body: { threadId: "t1", username: "alice", password: "fake-card-pass" } }]);
    expect(settled).toEqual([]);
  });

  it("answers a card in a thread the caller cannot see as one that does not exist, and touches nothing", async () => {
    const { base, settled, saved, targets, post } = await serve();
    for (const action of ["done", "cancel"]) {
      const response = await post(`/api/bots/scout/sign-in-cards/m1/${action}`, { threadId: "hidden" });
      expect({ status: response.status, body: await response.json() }).toEqual({ status: 404, body: { error: "no such sign-in request" } });
    }
    expect((await post("/api/bots/scout/sign-in-cards/m1/save-login", { threadId: "hidden", password: "fake-card-pass" })).status).toBe(404);
    expect((await fetch(`${base}/api/bots/scout/sign-in-cards/m1/save-login?threadId=hidden`)).status).toBe(404);
    expect([settled, saved, targets]).toEqual([[], [], []]);
  });

  it("takes a login as JSON only, so another page's form cannot post one", async () => {
    const { saved, post } = await serve();
    expect((await post("/api/bots/scout/sign-in-cards/m1/save-login", { threadId: "t1", password: "fake-card-pass" }, "text/plain")).status).toBe(415);
    expect(saved).toEqual([]);
  });
});
