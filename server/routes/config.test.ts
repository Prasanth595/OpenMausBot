import { expect, it, vi } from "vitest";
import { createConfigRoutes, type ConfigRouteDeps } from "./config.ts";
import type { RouteContext } from "./table.ts";

it("aborts prepared profile cleanup when approval-review settings become busy", async () => {
  const cleanupRequest = { profileId: "work" };
  const abort = vi.fn();
  const commit = vi.fn();
  const config = { browserProfiles: [{ id: "work", name: "Work" }] };
  let busyChecks = 0;
  let response: { status: number; body: unknown } | undefined;
  const deps = {
    store: { bots: [], patchBot: vi.fn(), clearVoiceSelections: vi.fn() },
    cfg: config,
    registry: { get: vi.fn(), forgetSnapshots: vi.fn() },
    sessions: { revalidateEmailSessions: vi.fn() },
    browserCleanup: {
      hasPendingProfile: vi.fn(() => false),
      prepare: vi.fn(() => cleanupRequest),
      abort,
      commit,
      ensure: vi.fn(),
    },
    browserLive: { closeAll: vi.fn(), closeForSession: vi.fn() },
    browserRuntime: { heldBy: vi.fn(() => false) },
    usedBrowserSessions: new Map(),
    closeBrowser: vi.fn(async () => true),
    browserEngineSwitched: vi.fn(),
    decider: { testKey: vi.fn(async () => ({ ok: true })) },
    sharedComputers: { close: vi.fn() },
    sharedComputerControl: { close: vi.fn() },
    hostedModels: false,
    cloudHome: false,
    lendingEnabled: () => true,
    providerConfigs: () => ({}),
    localVmIdleMs: () => 0,
    localVmIdles: { values: () => [] },
    localVmActiveThreads: new Set(),
    localVmLifecycleBusy: new Set(),
    localVmImageBusy: { get: () => false },
    localVmModeChangeBusy: { set: vi.fn() },
    providerConfigBusy: { get: () => false, set: vi.fn() },
    computerProviderConfigTransitions: new Set(),
    managedBoatOwners: () => [],
    providerOperationConflict: () => null,
    perBotLocalVmCountForModeChange: async () => 0,
    checkedModelSelection: () => ({ ok: false, status: 400, error: "not used" }),
    policyModelRefusal: () => undefined,
    browserSessionSpec: () => ({ command: "fixture", env: {} }),
    approvalReviewSettingsBusy: vi.fn(() => ++busyChecks === 2),
    configStatus: () => config,
    configForAccess: (status: unknown) => status,
    resyncOpenCodeProviderKeys: vi.fn(),
    revokeEngineCapabilities: vi.fn(),
    reloadProviders: vi.fn(async () => {}),
    broadcast: vi.fn(),
    drainQueuedSends: vi.fn(),
  } as unknown as ConfigRouteDeps;
  const route = createConfigRoutes(deps);
  const context = {
    req: {} as never,
    res: {} as never,
    url: new URL("http://fixture/api/config"),
    path: "/api/config",
    method: "PATCH",
    auth: {} as never,
    json: ((_res: unknown, status: number, body: unknown) => { response = { status, body }; }) as RouteContext["json"],
    readBody: (async () => ({
      approvalReview: { instructions: "updated instructions" },
      browserProfiles: [],
      decider: { key: "fixture-key" },
    })) as RouteContext["readBody"],
  } as RouteContext;

  await route(context);

  expect(response?.status).toBe(409);
  expect(deps.browserCleanup.prepare).toHaveBeenCalledOnce();
  expect(abort).toHaveBeenCalledExactlyOnceWith(cleanupRequest);
  expect(commit).not.toHaveBeenCalled();
  expect(config.browserProfiles).toEqual([{ id: "work", name: "Work" }]);
});
