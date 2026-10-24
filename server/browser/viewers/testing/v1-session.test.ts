import { afterEach, describe, expect, it, vi } from "vitest";

import { runV1Session } from "./v1-session.ts";

const ORIGIN = "http://fixture.test";
const FRAME = { seq: 1, format: "jpeg", data: "/9j/", metadata: {} };

function sessionDriver({ targetStep, synchronousFrameStep }: { targetStep?: string; synchronousFrameStep?: string } = {}) {
  const actions: string[] = [];
  let writeEvent: ((type: string, data: Record<string, unknown>) => void) | undefined;
  let startTargetStep: ((step: string) => void) | undefined;
  const targetStarted = new Promise<string>((resolve) => { startTargetStep = resolve; });

  return {
    actions,
    targetStarted,
    emitFrame() {
      if (!writeEvent) throw new Error("The session has not opened its event stream.");
      writeEvent("frame", FRAME);
    },
    driver: {
      open: async (response: { write(chunk: string): unknown }) => {
        writeEvent = (type, data) => { response.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); };
        writeEvent("ready", { viewerId: "viewer-1" });
      },
      action: async (_viewerId: string, body: Record<string, unknown>) => {
        if (body.type === "ack") return { ok: true };
        const step = String(body.type);
        actions.push(step);
        if (step === synchronousFrameStep) writeEvent?.("frame", FRAME);
        if (step === targetStep) startTargetStep?.(step);
        return { ok: true };
      },
    },
  };
}

describe("runV1Session frame gates", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    { step: "forward", nextStep: "reload" },
    { step: "reload", nextStep: "release" },
  ])("waits for the JPEG before continuing after $step", async ({ step, nextStep }) => {
    vi.useFakeTimers();
    const fixture = sessionDriver({ targetStep: step });
    const recordsPromise = runV1Session(fixture.driver, ORIGIN, {
      settleMs: 0,
      frameSteps: new Set([step]),
      frameTimeoutMs: 1_000,
    });

    await vi.advanceTimersByTimeAsync(100);
    expect(await fixture.targetStarted).toBe(step);
    const nextStepWasSentBeforeFrame = fixture.actions.includes(nextStep);
    fixture.emitFrame();
    await vi.advanceTimersByTimeAsync(100);
    const records = await recordsPromise;
    const framesByStep = records.map(({ step: name, events }) => ({
      step: name,
      count: events.filter((event) => event.type === "frame").length,
    }));

    expect(nextStepWasSentBeforeFrame).toBe(false);
    expect(framesByStep.filter(({ count }) => count > 0)).toEqual([{ step, count: 1 }]);
  });

  it("catches a JPEG emitted synchronously by the required action", async () => {
    vi.useFakeTimers();
    const fixture = sessionDriver({ synchronousFrameStep: "forward" });
    const recordsPromise = runV1Session(fixture.driver, ORIGIN, {
      settleMs: 0,
      frameSteps: new Set(["forward"]),
      frameTimeoutMs: 1_000,
    });
    const outcomePromise = recordsPromise.then(
      (records) => ({ records }),
      (error: unknown) => ({ error }),
    );

    await vi.advanceTimersByTimeAsync(100);
    if (vi.getTimerCount() > 0) await vi.advanceTimersByTimeAsync(1_000);
    const outcome = await outcomePromise;
    if ("error" in outcome) throw outcome.error;
    const records = outcome.records;
    const forward = records.find(({ step }) => step === "forward");

    expect(forward?.events.filter((event) => event.type === "frame")).toHaveLength(1);
  });

  it("reports which step timed out without its JPEG", async () => {
    vi.useFakeTimers();
    const fixture = sessionDriver({ targetStep: "forward" });
    const recordsPromise = runV1Session(fixture.driver, ORIGIN, {
      settleMs: 0,
      frameSteps: new Set(["forward"]),
      frameTimeoutMs: 1_000,
    });
    const failure = expect(recordsPromise).rejects.toThrow("Timed out waiting for a JPEG frame after v1 step \"forward\"");

    await vi.advanceTimersByTimeAsync(100);
    expect(await fixture.targetStarted).toBe("forward");
    await vi.advanceTimersByTimeAsync(1_000);
    await failure;
  });
});
