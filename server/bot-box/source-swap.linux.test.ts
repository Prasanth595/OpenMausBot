import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BotBox, BoxRunner } from "./box.ts";
import { launcherScript } from "../browser/chrome/wrapper.ts";
import { detectBox } from "./detect.ts";
import { bwrapArgs, planBox, type BoxRequest } from "./plan.ts";
import { closeMountFds } from "./pin.ts";

const detection = detectBox({ env: { ...process.env, OMB_BOT_BOX: "1" } });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(grant: string) {
  const root = mkdtempSync(join(tmpdir(), "omb-source-swap-"));
  roots.push(root);
  const home = join(root, "home"), dataDir = join(root, "data"), source = grant === "home" ? home : join(root, "grant");
  for (const path of new Set([home, dataDir, source])) mkdirSync(path);
  writeFileSync(join(dataDir, "messages.db"), "private fixture");
  writeFileSync(join(source, "allowed.txt"), "allowed fixture");
  const setup = { home, dataDir, codeRoots: [], engineRoots: [], bridges: [] };
  const request: BoxRequest = { command: "/bin/sh", args: [], env: { HOME: home }, net: "shared",
    ...(grant === "cwd" ? { cwd: source } : grant === "rw" ? { rw: [source] } : grant === "ro" ? { ro: [source] } : {}),
  };
  const script = `for file in ${source}/messages.db ${dataDir}/messages.db; do if test -r "$file"; then echo exposed; else echo hidden; fi; (echo changed >> "$file") 2>/dev/null || :; done; cat ${source}/allowed.txt; echo; if (echo changed >> ${source}/allowed.txt) 2>/dev/null; then echo writable; else echo read-only; fi`;
  const swap = () => { renameSync(source, `${source}-saved`); symlinkSync(dataDir, source); };
  return { setup, request, source, dataDir, script, swap };
}

function probe(args: string[], fds: number[], script: string): string[] {
  const result = spawnSync(detection.tools!.bwrap, [...args, "--", "/bin/sh", "-c", script], {
    encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe", ...fds],
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().split("\n");
}

describe.skipIf(detection.box !== "bwrap")("mount source pinning in real bubblewrap", () => {
  it.each(["home", "cwd", "rw", "ro"])("keeps the approved %s directory after a swap between wrap and launch", (grant) => {
    const f = fixture(grant);
    const runner = new BoxRunner({ bwrap: detection.tools!.bwrap, bridge: { socat: null, node: process.execPath, bridgeScript: "unused" }, setup: f.setup, denyEnv: new Set() });
    const wrapped = runner.wrap(f.request);
    try {
      f.swap();
      expect(probe(wrapped.args.slice(0, wrapped.args.indexOf("--")), wrapped.extraFds, f.script)).toEqual(["hidden", "hidden", "allowed fixture", grant === "ro" ? "read-only" : "writable"]);
      expect(readFileSync(join(f.dataDir, "messages.db"), "utf8")).toBe("private fixture");
    } finally {
      closeMountFds(wrapped.extraFds);
      wrapped.release();
    }
  });

  it.each(["home", "cwd", "rw", "ro"])("refuses a %s symlink introduced after planning, before pinning", (grant) => {
    const f = fixture(grant), fds: number[] = [];
    const plan = planBox(f.setup, f.request);
    f.swap();
    try {
      const args = bwrapArgs(plan, fds);
      expect(probe(args, fds, f.script)).toEqual(["hidden", "hidden", "allowed fixture", grant === "ro" ? "read-only" : "writable"]);
    } catch (error) {
      expect((error as Error).message).toMatch(/mount source changed/);
    } finally { closeMountFds(fds); }
    expect(readFileSync(join(f.dataDir, "messages.db"), "utf8")).toBe("private fixture");
  });

  it.each(["file", "directory"])("keeps an explicit read-only file protected through a writable %s alias", (grant) => {
    const f = fixture("rw"), file = join(f.source, "allowed.txt"), alias = join(f.source, "..", "alias");
    symlinkSync(grant === "file" ? file : f.source, alias);
    const target = grant === "file" ? alias : join(alias, "allowed.txt");
    const runner = new BoxRunner({ bwrap: detection.tools!.bwrap, bridge: { socat: null, node: process.execPath, bridgeScript: "unused" }, setup: f.setup, denyEnv: new Set() });
    const wrapped = runner.wrap({ ...f.request, rw: [alias], ro: [target] });
    try {
      expect(probe(wrapped.args.slice(0, wrapped.args.indexOf("--")), wrapped.extraFds, "if (echo changed > " + target + ") 2>/dev/null; then echo writable; else echo read-only; fi; cat " + target)).toEqual(["read-only", "allowed fixture"]);
      expect(readFileSync(file, "utf8")).toBe("allowed fixture");
    } finally { closeMountFds(wrapped.extraFds); }
  });

  it("keeps Pi's session writable when argv also names its explicit writable grant", () => {
    const f = fixture("rw"), file = join(f.dataDir, "session.jsonl");
    writeFileSync(file, "session fixture\n");
    const runner = new BoxRunner({ bwrap: detection.tools!.bwrap, bridge: { socat: null, node: process.execPath, bridgeScript: "unused" }, setup: f.setup, denyEnv: new Set() });
    const wrapped = runner.wrap({ ...f.request, args: ["--session", file], rw: [file] });
    try {
      expect(probe(wrapped.args.slice(0, wrapped.args.indexOf("--")), wrapped.extraFds, "echo appended >> " + file + "; cat " + file)).toEqual(["session fixture", "appended"]);
      expect(readFileSync(file, "utf8")).toBe("session fixture\nappended\n");
    } finally { closeMountFds(wrapped.extraFds); }
  });

  it("pins the generated browser launcher's sources and its writable profile", async () => {
    const f = fixture("ro"), box = new BotBox();
    try {
      await box.start({ ...f.setup, port: 8799, denyEnv: new Set(), env: {}, log: () => {}, detect: () => detection });
      const browser = box.browserBox(9, [f.source])!;
      const path = join(f.setup.home, "launcher.sh"), profile = join(f.dataDir, "browser", "profile");
      writeFileSync(path, launcherScript({ chrome: "/bin/sh", userAgent: "fixture", screen: { width: 1280, height: 800 }, box: browser }, "linux"));
      const script = `cat ${f.source}/allowed.txt; echo; if test -r ${f.dataDir}/messages.db; then echo exposed; else echo hidden; fi; echo profile > ${profile}/saved.txt`;
      const run = () => spawnSync("/bin/sh", [path, "-c", script, `--user-data-dir=${profile}`], { encoding: "utf8", timeout: 10_000 });
      const allowed = run();
      expect(allowed.status, allowed.stderr).toBe(0);
      expect(allowed.stdout.trim().split("\n")).toEqual(["allowed fixture", "hidden"]);
      expect(readFileSync(join(profile, "saved.txt"), "utf8")).toBe("profile\n");
      f.swap();
      const refused = run();
      expect(refused.status).not.toBe(0);
      expect(refused.stderr).toContain("mount source changed");
      expect(readFileSync(join(f.dataDir, "messages.db"), "utf8")).toBe("private fixture");
    } finally { await box.stop(); }
  });

  it("ends bubblewrap when the browser's launcher process is stopped", async () => {
    const f = fixture("ro"), box = new BotBox();
    let child: ChildProcess | undefined;
    try {
      await box.start({ ...f.setup, port: 8799, denyEnv: new Set(), env: {}, log: () => {}, detect: () => detection });
      const path = join(f.setup.home, "launcher.sh");
      writeFileSync(path, launcherScript({ chrome: "/bin/sh", userAgent: "fixture", screen: { width: 1280, height: 800 }, box: box.browserBox(9, [])! }, "linux"));
      child = spawn("/bin/sh", [path, "-c", "echo ready; exec /bin/sleep 60"], { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "", stderr = "";
      child.stdout!.on("data", (chunk) => { stdout += chunk; });
      child.stderr!.on("data", (chunk) => { stderr += chunk; });
      await expect.poll(() => child!.exitCode === null ? stdout : stderr, { timeout: 5_000 }).toContain("ready");
      const boxedPid = Number(readFileSync(`/proc/${child.pid}/task/${child.pid}/children`, "utf8").trim());
      expect(boxedPid).toBeGreaterThan(1);
      const ended = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
      child.kill("SIGTERM");
      await ended;
      expect(() => readFileSync(`/proc/${boxedPid}/stat`)).toThrow(expect.objectContaining({ code: "ENOENT" }));
    } finally {
      if (child?.exitCode === null && child.signalCode === null) {
        const ended = new Promise<void>((resolve) => child!.once("exit", () => resolve()));
        child.kill("SIGKILL");
        await ended;
      }
      await box.stop();
    }
  }, 10_000);
});
