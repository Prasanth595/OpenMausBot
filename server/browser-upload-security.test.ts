import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ beforeRead: null as (() => void) | null }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    readSync: (...args: Parameters<typeof original.readSync>) => {
      hooks.beforeRead?.();
      return original.readSync(...args);
    },
  };
});

const { namedUploadPaths, uploadableFiles } = await import("./browser-upload.ts");
const dirs: string[] = [];
afterEach(() => {
  hooks.beforeRead = null;
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it.skipIf(process.platform === "win32")("refuses a second file reached through a directory swapped while the first file copies", () => {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "omb-upload-race-")));
  dirs.push(base);
  const workspace = join(base, "workspace"), sub = join(workspace, "sub"), outside = join(base, "outside");
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(outside);
  fs.writeFileSync(join(workspace, "large.bin"), Buffer.alloc(1024 * 1024 + 1));
  fs.writeFileSync(join(sub, "report.txt"), "report");
  fs.writeFileSync(join(outside, "report.txt"), "outside secret");
  const checked = uploadableFiles([join(workspace, "large.bin"), join(sub, "report.txt")], [workspace]);
  if ("error" in checked) throw new Error(checked.error);
  hooks.beforeRead = () => {
    hooks.beforeRead = null;
    fs.rmSync(sub, { recursive: true });
    fs.symlinkSync(outside, sub, "dir");
  };
  expect(() => namedUploadPaths(checked.files.map((file) => ({ file, name: null })), join(base, "uploads"), Date.now(), { everyFile: true })).toThrow();
});
