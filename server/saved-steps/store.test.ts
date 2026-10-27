import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Recipe } from "./rules.ts";
import { MAX_RECIPES, RecipeStore, UNUSED_MS } from "./store.ts";

const recipe = (id: string, key: string, lastUsedAt = 1_000): Recipe => ({
  id,
  key,
  request: key,
  reply: "Done.",
  steps: [{ tool: "launch_app", args: { name: "Notes" }, app: { name: "Notes" } }],
  createdAt: 1_000,
  lastUsedAt,
});

describe("RecipeStore", () => {
  let dir: string;
  let clock: number;
  let store: RecipeStore;
  const file = () => join(dir, "b1", "saved-steps.json");
  const onDisk = () => JSON.parse(readFileSync(file(), "utf8")) as { version: number; recipes: Recipe[] };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "saved-steps-store-"));
    clock = 5_000;
    store = new RecipeStore({ folder: (botId) => join(dir, botId), now: () => clock });
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("saves and finds by key, in a 0600 file", () => {
    store.save("b1", recipe("r1", "open notes"));
    expect(store.find("b1", "open notes")!.id).toBe("r1");
    expect(store.find("b1", "other")).toBeUndefined();
    expect(store.find("b2", "open notes")).toBeUndefined();
    expect(statSync(file()).mode & 0o777).toBe(0o600);
  });

  it("replaces the recipe for the same key", () => {
    store.save("b1", recipe("r1", "open notes"));
    store.save("b1", recipe("r2", "open notes"));
    expect(store.find("b1", "open notes")!.id).toBe("r2");
    expect(onDisk().recipes.map((r) => r.id)).toEqual(["r2"]);
  });

  it("keeps the 200 most recently used", () => {
    for (let i = 0; i <= MAX_RECIPES; i++) store.save("b1", recipe(`r${i}`, `key ${i}`, 1_000 + i));
    expect(onDisk().recipes).toHaveLength(MAX_RECIPES);
    expect(store.find("b1", "key 0")).toBeUndefined();
    expect(store.find("b1", "key 1")!.id).toBe("r1");
    expect(store.find("b1", `key ${MAX_RECIPES}`)!.id).toBe(`r${MAX_RECIPES}`);
  });

  it("drops a recipe unused for 60 days", () => {
    store.save("b1", recipe("r1", "open notes", 1_000));
    clock = 1_000 + UNUSED_MS;
    expect(store.find("b1", "open notes")!.id).toBe("r1");
    clock = 1_000 + UNUSED_MS + 1;
    expect(store.find("b1", "open notes")).toBeUndefined();
    store.save("b1", recipe("r2", "open mail", clock));
    expect(onDisk().recipes.map((r) => r.id)).toEqual(["r2"]);
  });

  it("touch moves lastUsedAt to now", () => {
    store.save("b1", recipe("r1", "open notes", 1_000));
    clock = 9_000;
    store.touch("b1", "r1");
    expect(store.find("b1", "open notes")!.lastUsedAt).toBe(9_000);
    expect(onDisk().recipes[0]!.lastUsedAt).toBe(9_000);
  });

  it("forget answers whether it removed something", () => {
    store.save("b1", recipe("r1", "open notes"));
    expect(store.forget("b1", "r1")).toBe(true);
    expect(store.forget("b1", "r1")).toBe(false);
    expect(store.find("b1", "open notes")).toBeUndefined();
    expect(onDisk().recipes).toEqual([]);
  });

  it("reads a corrupt or other-version file as empty and rewrites it on save", () => {
    mkdirSync(join(dir, "b1"));
    writeFileSync(file(), "{nope");
    expect(store.find("b1", "open notes")).toBeUndefined();
    expect(store.forget("b1", "r1")).toBe(false);
    store.save("b1", recipe("r1", "open notes"));
    expect(onDisk().version).toBe(1);
    expect(store.find("b1", "open notes")!.id).toBe("r1");
    writeFileSync(file(), JSON.stringify({ version: 2, recipes: [recipe("r1", "open notes")] }));
    expect(store.find("b1", "open notes")).toBeUndefined();
  });

  it("drops malformed recipes and keeps the rest", () => {
    mkdirSync(join(dir, "b1"));
    const bad = { ...recipe("r1", "open notes"), steps: "x" };
    writeFileSync(file(), JSON.stringify({ version: 1, recipes: [bad, recipe("r2", "open mail")] }));
    expect(store.find("b1", "open notes")).toBeUndefined();
    expect(store.find("b1", "open mail")!.id).toBe("r2");
  });
});
