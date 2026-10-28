import { describe, expect, it } from "vitest";
import type { JournalEntry } from "./driver-wire.ts";
import { ComputerJournal, hostScope, parseJournalEntry } from "./journal.ts";
import { createSavedSteps } from "./saved-steps.ts";

const scope = { botId: "b1", threadId: "t1", generation: "g1" };
const CLICK: JournalEntry = { tool: "click", arguments: { element: "Save" }, result: { isError: false } };
const TYPE: JournalEntry = { tool: "type_text", arguments: { text: "hi" }, result: { isError: false } };

describe("computer journal", () => {
  it("returns the request's calls in order with the generation they ran in", () => {
    const j = new ComputerJournal();
    j.gateChecked(scope); j.gateChecked(scope);
    j.record(scope, CLICK); j.record(scope, TYPE);
    const taken = j.take("t1", new Set(["g1"]))!;
    expect(taken.calls.map((c) => [c.tool, c.generation])).toEqual([["click", "g1"], ["type_text", "g1"]]);
    expect(taken.complete).toBe(true);
    expect(taken.tainted).toBe(false);
  });

  it("is incomplete when a gated call never journals", () => {
    const j = new ComputerJournal(); j.gateChecked(scope); j.gateChecked(scope); j.record(scope, CLICK);
    expect(j.take("t1", new Set(["g1"]))!.complete).toBe(false);
  });

  it("is incomplete when an entry arrives with no gate check behind it", () => {
    const j = new ComputerJournal(); j.record(scope, CLICK);
    const taken = j.take("t1", new Set(["g1"]))!;
    expect(taken.complete).toBe(false);
    expect(taken.calls).toHaveLength(1);
  });

  it("is incomplete past the per-thread cap", () => {
    const j = new ComputerJournal({ callsPerThread: 2 });
    for (let i = 0; i < 3; i++) { j.gateChecked(scope); j.record(scope, CLICK); }
    const taken = j.take("t1", new Set(["g1"]))!;
    expect(taken.complete).toBe(false);
    expect(taken.calls).toHaveLength(2);
  });

  it("keeps two turns of one request together and drops other requests' leftovers", () => {
    const j = new ComputerJournal();
    for (const [generation, entry] of [["g0", TYPE], ["g1", CLICK], ["g2", TYPE]] as const) {
      j.gateChecked({ ...scope, generation }); j.record({ ...scope, generation }, entry);
    }
    const taken = j.take("t1", new Set(["g1", "g2"]))!;
    expect(taken.calls.map((c) => c.generation)).toEqual(["g1", "g2"]);
    expect(taken.complete).toBe(true);
    expect(j.take("t1", new Set(["g1", "g2"]))).toBeNull();
  });

  it("returns null when nothing was seen for the asked generations", () => {
    const j = new ComputerJournal(); j.gateChecked(scope); j.record(scope, CLICK);
    expect(j.take("t1", new Set(["g9"]))).toBeNull();
    expect(j.take("other", new Set(["g1"]))).toBeNull();
  });

  it("taints only the named generation", () => {
    const j = new ComputerJournal();
    j.taint(scope);
    expect(j.take("t1", new Set(["g1"]))!.tainted).toBe(true);
    j.taint(scope);
    const g2 = { ...scope, generation: "g2" };
    j.gateChecked(g2); j.record(g2, CLICK);
    expect(j.take("t1", new Set(["g2"]))!.tainted).toBe(false);
  });

  it("is tainted when any turn of the request was, even one that made no calls", () => {
    const j = new ComputerJournal();
    j.taint(scope);
    const g2 = { ...scope, generation: "g2" };
    j.gateChecked(g2); j.record(g2, CLICK);
    const taken = j.take("t1", new Set(["g1", "g2"]))!;
    expect(taken.tainted).toBe(true);
    expect(taken.complete).toBe(true);
    expect(taken.calls.map((c) => [c.tool, c.generation])).toEqual([["click", "g2"]]);
  });

  it("keeps a gate-refused entry in the journal", () => {
    const j = new ComputerJournal(); j.gateChecked(scope); j.record(scope, { ...CLICK, result: { isError: true } });
    const taken = j.take("t1", new Set(["g1"]))!;
    expect(taken.calls[0].result.isError).toBe(true);
    expect(taken.complete).toBe(true);
  });

  it("evicts the oldest thread past the thread cap", () => {
    const j = new ComputerJournal({ threads: 2 });
    for (const threadId of ["t1", "t2", "t3"]) j.record({ ...scope, threadId }, CLICK);
    expect(j.take("t1", new Set(["g1"]))).toBeNull();
    expect(j.take("t3", new Set(["g1"]))).not.toBeNull();
  });

  it("journals only this computer's turns", () => {
    expect(hostScope({ ...scope, kind: "computer" })).toEqual(scope);
    expect(hostScope({ ...scope, kind: "computer", boxId: null })).toBeNull();
    expect(hostScope({ ...scope, kind: "computer", localVmTarget: {} })).toBeNull();
    expect(hostScope({ ...scope, kind: "computer", teamComputerId: "tc" })).toBeNull();
    expect(hostScope({ ...scope, kind: "browser" })).toBeNull();
  });

  it("counts gate checks only for host computer turns", () => {
    const saved = createSavedSteps({ enabled: () => true, publish: () => {}, engines: { get: () => undefined, set: () => {} }, stopped: () => false, generation: () => "g1", patchMessage: () => {} });
    saved.gateChecked({ ...scope, kind: "computer", boxId: null });
    saved.gateChecked({ ...scope, kind: "browser" });
    expect(saved.journal.take("t1", new Set(["g1"]))).toBeNull();
    saved.gateChecked({ ...scope, kind: "computer" });
    saved.journal.record(scope, CLICK);
    expect(saved.journal.take("t1", new Set(["g1"]))!.complete).toBe(true);
  });

  it("rejects malformed entries", () => {
    expect(parseJournalEntry(CLICK)).toEqual(CLICK);
    expect(parseJournalEntry({ tool: "../x", arguments: {}, result: { isError: false } })).toBeNull();
    expect(parseJournalEntry({ tool: "click", arguments: [], result: { isError: false } })).toBeNull();
    expect(parseJournalEntry({ tool: "click", arguments: {}, result: {} })).toBeNull();
    expect(parseJournalEntry(null)).toBeNull();
  });
});
