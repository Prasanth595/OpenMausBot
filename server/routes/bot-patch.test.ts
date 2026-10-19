import { expect, it, vi } from "vitest";
import { createBotPatchRoutes, type BotPatchRouteDeps } from "./bot-patch.ts";

it("rechecks unpaired Auto elevation after interruption yields to another turn", async () => {
  const bot = { id: "fixture", name: "Fixture", soul: "", computer: "local", approvalMode: "ask", busy: false, modelSelection: { instanceId: "fixture", model: "fixture" } };
  const patchBot = vi.fn();
  const interrupt = vi.fn(async () => { bot.busy = true; });
  const deps = {
    store: { bot: () => bot, bots: [bot], groups: [], patchBot, taskByThread: () => undefined },
    cfg: {}, registry: { get: () => undefined }, sessions: { isLive: () => false },
    browserRuntime: { heldBy: () => false },
    routines: () => ({ activeBotRunForBot: () => undefined }), activeVpsThreads: { has: () => false },
    requestedTaskBot: () => null, supportsApprovalMode: () => true, activeGroupTurnForBot: () => undefined,
    interruptAllDirectThreads: interrupt, desktopManaged: false, hostedWorkspace: false,
  } as unknown as BotPatchRouteDeps;
  const route = createBotPatchRoutes(deps);
  const json = vi.fn();
  await route({ req: { headers: {} }, res: {}, path: "/api/bots/fixture", method: "PATCH", auth: { kind: "loopback" },
    json, readBody: async () => ({ computer: "off", approvalMode: "auto" }),
  } as unknown as Parameters<typeof route>[0]);
  expect(interrupt).toHaveBeenCalledOnce();
  expect(json).toHaveBeenCalledWith(expect.anything(), 409, { error: expect.stringContaining("Change approval mode") });
  expect(patchBot).not.toHaveBeenCalled();
});
