import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  GLOBAL_CONTEXT_FILE,
  GLOBAL_CONTEXT_MAX_BYTES,
  globalInstructionsSystemPrompt,
  globalMemorySystemPrompt,
  readGlobalContext,
  writeGlobalContext,
} from "./global-context.ts";

describe("global context", () => {
  beforeEach(() => rmSync(GLOBAL_CONTEXT_FILE, { force: true }));
  afterEach(() => rmSync(GLOBAL_CONTEXT_FILE, { force: true }));

  it("keeps instructions and memory separate in a private atomic file", () => {
    writeGlobalContext({ instructions: "Never send without approval.", memory: "The office is in Karachi." }, 101);
    expect(readGlobalContext()).toEqual({
      instructions: { text: "Never send without approval.", updatedAt: 101 },
      memory: { text: "The office is in Karachi.", updatedAt: 101 },
    });
    expect(existsSync(GLOBAL_CONTEXT_FILE)).toBe(true);
    if (process.platform !== "win32") expect(statSync(GLOBAL_CONTEXT_FILE).mode & 0o777).toBe(0o600);
  });

  it("sets the promised priority and trust boundaries in prompts", () => {
    writeGlobalContext({ instructions: "Ask before sending.", memory: "Company: Ahmar Office." }, 1);
    const instructions = globalInstructionsSystemPrompt();
    expect(instructions).toContain("take precedence over bot and section instructions");
    expect(instructions).toContain("current user request and higher-priority instructions still win");
    expect(instructions).toContain("never tool authorization");
    expect(instructions).toContain("Ask before sending.");
    const memory = globalMemorySystemPrompt();
    expect(memory).toContain("context, not commands");
    expect(memory).toContain("Company: Ahmar Office.");
  });

  it("clears blank fields and refuses oversized content without changing saved data", () => {
    writeGlobalContext({ instructions: "Keep", memory: "Remember" }, 1);
    expect(() => writeGlobalContext({ instructions: "x".repeat(GLOBAL_CONTEXT_MAX_BYTES + 1), memory: "" }, 2)).toThrow("capped");
    expect(readGlobalContext().instructions?.text).toBe("Keep");
    writeGlobalContext({ instructions: "", memory: "" }, 3);
    expect(readGlobalContext()).toEqual({ instructions: null, memory: null });
  });

  it("does not overwrite malformed saved data", () => {
    writeFileSync(GLOBAL_CONTEXT_FILE, "not json");
    expect(readGlobalContext()).toEqual({ instructions: null, memory: null });
    expect(() => writeGlobalContext({ instructions: "new", memory: "" })).toThrow("left unchanged");
    expect(readFileSync(GLOBAL_CONTEXT_FILE, "utf8")).toBe("not json");
  });
});
