// Unit tests for the workshop crate subsystem. Like the self-modify tests,
// every disk-facing test runs in an isolated fixture: the vitest setup file
// has already redirected homedir() to a throwaway per-file home, so the
// workshop dir (DATA_DIR/workshop) lands inside it and the real ~/.astra is
// never touched.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const { WORKSHOP_DIR, deleteWorkshop, listWorkshop, readWorkshop, validWorkshopName, workshopNameError, writeWorkshop } =
  await import("./workshop.ts");

let home: string;

beforeEach(() => {
  // The workshop dir is derived from DATA_DIR under the redirected home; a
  // fresh throwaway home per test also resets it, and the explicit rm keeps
  // a prior test's files from leaking if module state ever outlives the
  // redirected home.
  home = mkdtempSync(join(tmpdir(), "omb-workshop-home-"));
  rmSync(WORKSHOP_DIR, { recursive: true, force: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(WORKSHOP_DIR, { recursive: true, force: true });
});

describe("validWorkshopName", () => {
  it("accepts plain names with an allowed suffix", () => {
    expect(validWorkshopName("expense-runbook.md")).toBe(true);
    expect(validWorkshopName("notes.txt")).toBe(true);
    expect(validWorkshopName("team_prompts.json")).toBe(true);
  });

  it("refuses everything that could leave the crate", () => {
    expect(validWorkshopName("../escape.md")).toBe(false);
    expect(validWorkshopName("sub/dir.md")).toBe(false);
    expect(validWorkshopName("sub\\dir.md")).toBe(false);
    expect(validWorkshopName("C:\\tmp.md")).toBe(false);
    expect(validWorkshopName("/etc/passwd.md")).toBe(false);
    expect(validWorkshopName(".hidden.md")).toBe(false);
    expect(validWorkshopName("no-suffix")).toBe(false);
    expect(validWorkshopName("wrong.markdown")).toBe(false);
    expect(validWorkshopName("")).toBe(false);
    expect(validWorkshopName(undefined)).toBe(false);
    expect(validWorkshopName(42)).toBe(false);
    expect(validWorkshopName(".")).toBe(false);
    expect(validWorkshopName("..")).toBe(false);
  });

  it("enforces the 64-character name cap", () => {
    const atCap = "a".repeat(64 - 3) + ".md"; // 61 letters + ".md" = 64
    const overCap = "a".repeat(64 - 2) + ".md";
    expect(atCap.length).toBe(64);
    expect(validWorkshopName(atCap)).toBe(true);
    expect(validWorkshopName(overCap)).toBe(false);
  });

  it("explains the refusal in words an agent can act on", () => {
    // "../escape.md" fails at the first character, like every dotfile.
    expect(workshopNameError("../escape.md")).toContain("must start with a letter or digit");
    expect(workshopNameError("no-suffix")).toContain(".md");
    expect(workshopNameError("ok.md")).toBe("");
    expect(workshopNameError(`${"a".repeat(70)}.md`)).toContain("64");
  });
});

describe("workshop crate mechanics", () => {
  it("starts empty and auto-creates the crate on first write", () => {
    expect(listWorkshop()).toEqual([]);
    expect(existsSync(WORKSHOP_DIR)).toBe(false);
    const write = writeWorkshop("draft.md", "# hello\n");
    expect(write.ok).toBe(true);
    expect(existsSync(WORKSHOP_DIR)).toBe(true);
    expect(readFileSync(join(WORKSHOP_DIR, "draft.md"), "utf8")).toBe("# hello\n");
  });

  it("round-trips a read with byte-exact content and metadata", () => {
    writeWorkshop("draft.md", "line1\nline2\n");
    const read = readWorkshop("draft.md");
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error("expected ok");
    expect(read.content).toBe("line1\nline2\n");
    expect(read.bytes).toBe(12);
    expect(read.updatedAt).toBeTruthy();
  });

  it("tables unknown reads as 404", () => {
    const read = readWorkshop("ghost.md");
    expect(read.ok).toBe(false);
    if (!read.ok) expect(read.status).toBe(404);
  });

  it("replaces a resource whole on rewrite", () => {
    writeWorkshop("draft.md", "first\n");
    writeWorkshop("draft.md", "second\n");
    expect(readWorkshop("draft.md")).toMatchObject({ ok: true, content: "second\n" });
    expect(listWorkshop()).toHaveLength(1);
  });

  it("refuses non-string content and oversized writes", () => {
    expect(writeWorkshop("draft.md", 12345).ok).toBe(false);
    const big = "x".repeat(64 * 1024 + 1);
    const write = writeWorkshop("draft.md", big);
    expect(write.ok).toBe(false);
    if (!write.ok) {
      expect(write.status).toBe(413);
      expect(write.error).toContain("64 KiB");
    }
    // Exactly 64 KiB passes.
    const atLimit = writeWorkshop("draft.md", "x".repeat(64 * 1024));
    expect(atLimit.ok).toBe(true);
  });

  it("validates .json content on every write", () => {
    expect(writeWorkshop("ok.json", '{"a":1}').ok).toBe(true);
    const bad = writeWorkshop("broken.json", "{not json");
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.status).toBe(400);
      expect(bad.error).toContain("valid JSON");
    }
  });

  it("deletes what it wrote and 404s the second delete", () => {
    writeWorkshop("gone.txt", "bye\n");
    expect(deleteWorkshop("gone.txt").ok).toBe(true);
    expect(existsSync(join(WORKSHOP_DIR, "gone.txt"))).toBe(false);
    const again = deleteWorkshop("gone.txt");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.status).toBe(404);
  });

  it("caps the crate at 24 files", () => {
    for (let i = 0; i < 24; i++) {
      expect(writeWorkshop(`res${i}.md`, "# d\n").ok).toBe(true);
    }
    expect(listWorkshop()).toHaveLength(24);
    const overflow = writeWorkshop("overflow.md", "# too much\n");
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.status).toBe(409);
    // Replacing an existing file is not a new file — it still passes.
    expect(writeWorkshop("res0.md", "x\n").ok).toBe(true);
  });

  it("lists only valid names, sorted, with stable hashes", () => {
    writeWorkshop("b.md", "second\n");
    writeWorkshop("a.md", "first\n");
    const listing = listWorkshop();
    expect(listing.map((item) => item.name)).toEqual(["a.md", "b.md"]);
    expect(listing[0]!.bytes).toBe(6);
    expect(listing[0]!.sha256).toHaveLength(64);
    // Re-listing keeps the same hash for unchanged bytes.
    expect(listWorkshop().find((item) => item.name === "b.md")!.sha256).toBe(listing[1]!.sha256);
  });

  it("hides invalid names the operator dropped into the crate", () => {
    writeWorkshop("keep.md", "real\n");
    // An operator-created file that violates the naming rules is invisible
    // to the agent surface — never served, never counted as content.
    writeFileSync(join(WORKSHOP_DIR, "not-a-name"), "operator-only\n");
    writeFileSync(join(WORKSHOP_DIR, "..trash.md"), "dotfile-looking\n");
    const listing = listWorkshop();
    expect(listing.map((item) => item.name)).toEqual(["keep.md"]);
    // And the crate itself is not traversable, whatever someone drops in.
    expect(readWorkshop("../not-a-name").ok).toBe(false);
  });
});
