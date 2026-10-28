import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ beforeRead: null as (() => void) | null, redirect: null as { source: string; target: string } | null }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return {
    ...original,
    openSync: (...args: Parameters<typeof original.openSync>) => {
      const redirected = hooks.redirect && args[0] === hooks.redirect.source ? hooks.redirect.target : args[0];
      return original.openSync(redirected, args[1], args[2]);
    },
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
  hooks.redirect = null;
  vi.unstubAllGlobals();
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

it("rejects a Windows open that follows a symlink swapped in after lstat", () => {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "omb-upload-windows-")));
  dirs.push(base);
  const source = join(base, "report.txt"), secret = join(base, "secret.txt");
  fs.writeFileSync(source, "report");
  fs.writeFileSync(secret, "outside secret");
  vi.stubGlobal("process", { ...process, platform: "win32" });
  hooks.redirect = { source, target: secret };
  expect(() => namedUploadPaths([{ file: source, name: "Report.txt" }], join(base, "uploads"))).toThrow(/changed/);
});

it("removes every directory from a batch when its second file fails", () => {
  const base = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), "omb-upload-cleanup-")));
  dirs.push(base);
  const first = join(base, "first.txt"), folder = join(base, "uploads");
  fs.writeFileSync(first, "first");
  expect(() => namedUploadPaths([
    { file: first, name: "First.txt" }, { file: join(base, "missing.txt"), name: "Missing.txt" },
  ], folder)).toThrow();
  expect(fs.readdirSync(folder)).toEqual([]);
});
