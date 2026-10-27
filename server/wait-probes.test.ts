import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expandHome,
  fileChanged,
  fileStamp,
  listProcesses,
  pageSays,
  pageText,
  parsePs,
  parseTasklist,
  processRunning,
} from "./wait-probes.ts";

let dir = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "wait-probes-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("file and process probes", () => {
  it("expands ~ to the home folder and leaves other paths alone", () => {
    expect(expandHome("~", "/h")).toBe("/h");
    expect(expandHome("~/a/b.txt", "/h")).toBe(join("/h", "a/b.txt"));
    expect(expandHome("/x/y", "/h")).toBe("/x/y");
    expect(expandHome("~bob/x", "/h")).toBe("~bob/x");
  });
  it("stamps a file with its size and modification time, and a missing one as null", async () => {
    writeFileSync(join(dir, "r.txt"), "abc");
    expect(await fileStamp(join(dir, "r.txt"))).toEqual({ size: 3, mtimeMs: expect.any(Number) });
    expect(await fileStamp(join(dir, "none.txt"))).toBeNull();
  });
  it("sees a change in size or modification time and a file that appears, never a missing file", () => {
    expect(fileChanged({ size: 3, mtimeMs: 1 }, { size: 4, mtimeMs: 1 })).toBe(true);
    expect(fileChanged({ size: 3, mtimeMs: 1 }, { size: 3, mtimeMs: 2 })).toBe(true);
    expect(fileChanged({ size: 3, mtimeMs: 1 }, { size: 3, mtimeMs: 1 })).toBe(false);
    expect(fileChanged(null, { size: 0, mtimeMs: 1 })).toBe(true);
    expect(fileChanged({ size: 3, mtimeMs: 1 }, null)).toBe(false);
  });
  it("reads ps and tasklist output", () => {
    expect(parsePs("    1 /sbin/launchd\n  812 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n    9 node\n"))
      .toEqual([{ pid: 1, name: "launchd" }, { pid: 812, name: "Google Chrome" }, { pid: 9, name: "node" }]);
    expect(parseTasklist('"chrome.exe","1234","Console","1","123,456 K"\r\n"System","4","Services","0","1,000 K"\r\n'))
      .toEqual([{ pid: 1234, name: "chrome.exe" }, { pid: 4, name: "System" }]);
  });
  it("matches a program by name in any case, with or without .exe, by Linux's 15-character name, or by pid", () => {
    const entries = [{ pid: 812, name: "Google Chrome" }, { pid: 1234, name: "node.exe" }, { pid: 77, name: "gnome-shell-cal" }];
    for (const wanted of ["google chrome", "NODE", "node.exe", "gnome-shell-calendar-server", "812"]) expect(processRunning(entries, wanted), wanted).toBe(true);
    for (const wanted of ["google", "813", "gnome-shell"]) expect(processRunning(entries, wanted), wanted).toBe(false);
  });
  it("runs ps on macOS and Linux and tasklist on Windows, without a shell", async () => {
    const calls: unknown[] = [];
    const run = async (file: string, args: string[]) => { calls.push([file, args]); return ""; };
    await listProcesses("darwin", run); await listProcesses("linux", run); await listProcesses("win32", run);
    expect(calls).toEqual([["ps", ["-axo", "pid=,comm="]], ["ps", ["-axo", "pid=,comm="]], ["tasklist", ["/fo", "csv", "/nh"]]]);
  });
  it("lists this machine's processes, this one included", async () => {
    expect((await listProcesses()).some((entry) => entry.pid === process.pid)).toBe(true);
  });
  it("reads a page as words: tags, scripts and styles out, entities decoded, spaces collapsed", () => {
    const text = pageText("<html><head><style>p{}</style><script>var shipped=1</script></head><body><p>Status:&nbsp;<b>Shipped</b> &amp; done</p></body></html>");
    expect(text).toBe("Status: Shipped & done");
    expect(pageSays(text, "status:   SHIPPED")).toBe(true);
    expect(pageSays(text, "shipped=1")).toBe(false);
  });
});
