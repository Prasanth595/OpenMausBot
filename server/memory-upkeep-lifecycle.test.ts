import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR } from "./config.ts";
import { createMemoryUpkeep, TIDY_CHECK_MS, type MemoryUpkeep } from "./memory-upkeep.ts";
import { createMoveFreeze } from "./move-freeze.ts";
import { ensureWorkspace, readMemoryTopic, workspaceDir, writeMemoryFile } from "./workspace.ts";

const BOT = { id: "upkeep-lifecycle", name: "Scout" };
const NOTEBOOK = "- 2026-09-01 · Trip · until 2026-09-02\n";
const memory = () => readFileSync(join(workspaceDir(BOT.id), "MEMORY.md"), "utf8");

describe("scheduled memory upkeep", () => {
  let loop: MemoryUpkeep;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 25, 10));
    rmSync(DATA_DIR, { recursive: true, force: true });
    ensureWorkspace(BOT.id);
    writeMemoryFile(BOT.id, NOTEBOOK);
    loop = createMemoryUpkeep({
      bots: () => [BOT], bot: () => BOT, engine: () => null, busy: () => false,
      addToAboutMe: () => 0, sourceLabel: () => "chat", quietMs: () => 60_000, tidyHour: () => 3,
    });
  });

  afterEach(async () => {
    loop.stop();
    await loop.idle();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps a moved desktop's memory unchanged when frozen before the first tick", async () => {
    const freeze = createMoveFreeze({ dataDir: DATA_DIR });
    freeze.hold(() => loop.start(), () => loop.stop());
    freeze.freeze("https://fixture.example");
    await vi.advanceTimersByTimeAsync(TIDY_CHECK_MS);
    expect(memory()).toBe(NOTEBOOK);
    expect(readMemoryTopic(BOT.id, "archive.md")).toBeNull();
    expect(loop.status(BOT.id).lastTidy).toBeUndefined();
    freeze.unfreeze();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(memory()).not.toContain("Trip");
    expect(loop.status(BOT.id).lastTidy?.expired).toBe(1);
  });

  it("waits a full startup delay again after restarting", async () => {
    loop.start();
    await vi.advanceTimersByTimeAsync(30_000);
    loop.stop();
    loop.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(memory()).toBe(NOTEBOOK);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(memory()).not.toContain("Trip");
  });

  it.each(["startup", "interval"] as const)("ignores an already queued %s callback from a stopped generation", async (kind) => {
    const timeout = vi.spyOn(globalThis, "setTimeout");
    const interval = vi.spyOn(globalThis, "setInterval");
    loop.start();
    const callback = (kind === "startup" ? timeout.mock.calls[0]![0] : interval.mock.calls[0]![0]) as () => void;
    loop.stop();
    loop.start();
    callback();
    await loop.idle();
    expect(memory()).toBe(NOTEBOOK);
    expect(loop.status(BOT.id).lastTidy).toBeUndefined();
  });
});
