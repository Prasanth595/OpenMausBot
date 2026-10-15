import { describe, expect, it } from "vitest";
import { MAUS_STATES, normalizeState, stateForBot } from "./mascot";
import { zapMoodForExpression, zapMoodForState } from "./zap-dot-state";

describe("bot state to Zap mood", () => {
  it.each([
    ["idle", "idle"], ["listening", "idle"], ["thinking", "thinking"], ["searching", "thinking"],
    ["working", "working"], ["writing", "working"], ["loading", "thinking"], ["curious", "waiting"],
    ["notifying", "waiting"], ["alerting", "error"], ["sad", "error"], ["celebrate", "done"],
    ["happy", "done"], ["sleeping", "killed"], ["powering-down", "killed"],
  ] as const)("renders %s as %s", (state, mood) => {
    expect(zapMoodForState(state)).toBe(mood);
  });

  it("covers every existing state using only the seven reference moods", () => {
    expect(MAUS_STATES).toHaveLength(39);
    expect(new Set(MAUS_STATES.map(zapMoodForState)))
      .toEqual(new Set(["idle", "thinking", "working", "waiting", "done", "error", "killed"]));
  });

  it("leaves state selection and legacy persisted expressions unchanged", () => {
    const bot = { name: "Maus", busy: true, messages: [{ kind: "activity", tool: { ok: false } }] };
    expect(stateForBot(bot)).toBe("alerting");
    expect(zapMoodForState(stateForBot(bot))).toBe("error");
    expect(stateForBot({ ...bot, messages: [] })).toBe("working");
    expect(normalizeState("focused")).toBe("working");
    expect(zapMoodForState(normalizeState("sleepy")!)).toBe("killed");
    expect(zapMoodForExpression(25)).toBe(zapMoodForExpression(0));
    expect(zapMoodForExpression(-1)).toBe(zapMoodForExpression(24));
  });
});
