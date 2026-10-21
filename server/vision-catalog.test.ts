import { describe, expect, it } from "vitest";

import type { ModelCatalog } from "./contracts.ts";
import { mergeEnginesIntoVision } from "./vision-catalog.ts";

const vision = {
  driverKind: "vision",
  displayName: "Vision",
  models: {
    default: "auto",
    options: [
      { id: "auto", label: "Auto", custom: true },
      { id: "rlm:auto", label: "RLM Auto (Harness)", custom: true },
    ],
  } satisfies ModelCatalog,
};
const opencode = {
  driverKind: "opencodeGo",
  displayName: "OpenCode",
  models: {
    default: "opencode/x-preview-f-free",
    options: [
      { id: "opencode/x-preview-f-free", label: "Zen · Ox Alpha Free", contextWindow: 1_000_000 },
      { id: "openrouter/anthropic/claude-3.5-sonnet", label: "OpenRouter · Claude 3.5 Sonnet" },
    ],
  } satisfies ModelCatalog,
};
const local = {
  driverKind: "piAgent",
  displayName: "Pi",
  models: {
    default: "llama",
    options: [{ id: "llama", label: "Llama", custom: true, loaded: true, contextWindow: 8_192 }],
  } satisfies ModelCatalog,
};

describe("mergeEnginesIntoVision", () => {
  it("unions every other engine's collected models into the Vision row", () => {
    const [merged] = mergeEnginesIntoVision([vision, opencode, local]);
    expect(merged.models.options.map((option) => option.id)).toEqual([
      "auto",
      "rlm:auto",
      "opencode/x-preview-f-free",
      "openrouter/anthropic/claude-3.5-sonnet",
      "llama",
    ]);
  });

  it("marks merged rows custom (Vision's picker renders only custom options) and badges the engine", () => {
    const [, , , , llama] = mergeEnginesIntoVision([vision, opencode, local])[0].models.options;
    expect(llama).toEqual({
      id: "llama",
      label: "Llama",
      custom: true,
      provider: "Pi",
      loaded: true,
      contextWindow: 8_192,
    });
  });

  it("keeps the vision row's own options first, default, and untouched", () => {
    const [merged] = mergeEnginesIntoVision([vision, opencode]);
    expect(merged.models.default).toBe("auto");
    expect(merged.models.options.slice(0, 2)).toEqual(vision.models.options);
  });

  it("dedupes by id: a model Vision already lists is never repeated", () => {
    const withDup = {
      ...opencode,
      models: {
        default: "",
        options: [
          { id: "auto", label: "Auto (from OpenCode)" },
          { id: "opencode/x-preview-f-free", label: "Free" },
        ],
      },
    };
    const [merged] = mergeEnginesIntoVision([vision, withDup]);
    expect(merged.models.options.filter((option) => option.id === "auto")).toEqual([vision.models.options[0]]);
    expect(merged.models.options.filter((option) => option.id === "opencode/x-preview-f-free")).toHaveLength(1);
  });

  it("leaves other rows by reference and vision alone when no engine collected models", () => {
    const shadow = { driverKind: "claudeAgent", displayName: "Claude", models: { default: "", options: [] } };
    const rows = [vision, shadow];
    const [merged, untouched] = mergeEnginesIntoVision(rows);
    expect(merged).toBe(vision);
    expect(untouched).toBe(shadow);
  });

  it("passes a fleet with no vision row through unchanged", () => {
    const rows = [opencode, local];
    const out = mergeEnginesIntoVision(rows);
    expect(out).toEqual(rows);
    expect(out[0]).toBe(opencode);
  });

  it("gives each Vision instance its siblings' models without forgetting its own", () => {
    const second = {
      driverKind: "vision",
      displayName: "Vision (backup)",
      models: { default: "direct:deepseek-chat", options: [{ id: "direct:deepseek-chat", label: "DeepSeek", custom: true }] },
    };
    const out = mergeEnginesIntoVision([vision, second, { ...opencode, models: { default: "", options: [opencode.models.options[0]] } }]);
    expect(out[0].models.options.map((option) => option.id)).toContain("direct:deepseek-chat");
    expect(out[1].models.options.map((option) => option.id)).toContain("auto");
  });
});
