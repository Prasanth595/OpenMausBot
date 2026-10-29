import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FILE_INLINE_MAX_BYTES, fileBlock, inlineFiles } from "./file-reader.ts";

const roots: string[] = [];
function dir(): string {
  const root = mkdtempSync(join(tmpdir(), "omb-files-"));
  roots.push(root);
  return root;
}
const tag = (path: string, name: string) => `<attached-file path="${path}" name="${name}" />`;

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("inlineFiles", () => {
  it("sends a csv attached to the turn as text", () => {
    const root = dir();
    const path = join(root, "a1.csv");
    writeFileSync(path, "pedido;total\n4471;1284.90\n");
    const files = inlineFiles(`${tag(path, "pedido.csv")}\n\nqual o total?`, { attachmentsDir: root });
    expect(files).toHaveLength(1);
    expect(files[0]!.name).toBe("pedido.csv");
    expect(files[0]!.text).toContain("4471");
    expect(files[0]!.truncated).toBe(false);
    expect(fileBlock(files)).toContain("here is their content");
    expect(fileBlock(files)).toContain("4471");
  });

  it("never reads a path outside the attachments dir", () => {
    const root = dir();
    const other = dir();
    const path = join(other, "a2.csv");
    writeFileSync(path, "segredo");
    expect(inlineFiles(tag(path, "fora.csv"), { attachmentsDir: root })).toEqual([]);
  });

  it("leaves a binary file with only its tag", () => {
    const root = dir();
    const path = join(root, "a3.bin");
    writeFileSync(path, Buffer.from([0x00, 0x01, 0x02, 0x00]));
    expect(inlineFiles(tag(path, "foto.bin"), { attachmentsDir: root })).toEqual([]);
  });

  it("cuts a long text file and says so", () => {
    const root = dir();
    const path = join(root, "a4.txt");
    writeFileSync(path, "x".repeat(FILE_INLINE_MAX_BYTES * 2));
    const files = inlineFiles(tag(path, "longo.txt"), { attachmentsDir: root });
    expect(files).toHaveLength(1);
    expect(files[0]!.truncated).toBe(true);
    expect(files[0]!.text.length).toBeLessThanOrEqual(FILE_INLINE_MAX_BYTES);
    expect(fileBlock(files)).toContain("only the beginning is shown");
  });

  it("keeps three files and respects the turn budget", () => {
    const root = dir();
    const paths = ["a5.csv", "a6.csv", "a7.csv", "a8.csv"].map((name) => {
      const path = join(root, name);
      writeFileSync(path, `${name}\n`);
      return path;
    });
    const text = paths.map((path, index) => tag(path, `f${index}.csv`)).join("\n");
    expect(inlineFiles(text, { attachmentsDir: root, maxBytes: 8 })).toHaveLength(2);
    expect(inlineFiles(text, { attachmentsDir: root })).toHaveLength(3);
  });

  it("is not fooled by an image tag", () => {
    const root = dir();
    const path = join(root, "a9.png");
    writeFileSync(path, "nao-e-imagem");
    expect(inlineFiles(`<attached-image path="${path}" name="a.png" />`, { attachmentsDir: root })).toEqual([]);
  });
});
