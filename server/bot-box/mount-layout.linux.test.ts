import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { detectBox } from "./detect.ts";

const detection = detectBox({ env: { ...process.env, OMB_BOT_BOX: "1" } });
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function layout(scenario: string): unknown {
  const root = mkdtempSync(join(tmpdir(), "omb-mount-layout-"));
  roots.push(root);
  for (const path of ["var-lib", "srv", "home/fixture"]) mkdirSync(join(root, path), { recursive: true });
  const repo = fileURLToPath(new URL("../../", import.meta.url));
  const fixture = fileURLToPath(new URL("../testing/bot-box-mount-fixture.ts", import.meta.url));
  const result = spawnSync(detection.tools!.bwrap, [
    "--unshare-user", "--unshare-pid", "--unshare-net", "--die-with-parent",
    "--ro-bind", "/usr", "/usr", "--symlink", "usr/bin", "/bin", "--symlink", "usr/lib", "/lib",
    "--symlink", "usr/lib64", "/lib64", "--ro-bind", "/etc", "/etc", "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/tmp", "--tmpfs", "/run", "--bind", join(root, "var-lib"), "/var/lib",
    "--bind", join(root, "srv"), "/srv", "--bind", join(root, "home"), "/home",
    "--ro-bind", repo, repo, "--ro-bind", dirname(dirname(process.execPath)), dirname(dirname(process.execPath)),
    "--setenv", "HOME", "/home/fixture", "--setenv", "OMB_DATA_DIR", "/var/lib/openmausbot",
    "--chdir", repo, "--", process.execPath, "--experimental-strip-types", fixture, scenario,
  ], { encoding: "utf8", timeout: 20_000 });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.trim());
}

describe.skipIf(detection.box !== "bwrap")("synthetic filesystem layouts inside real bubblewrap", () => {
  it("keeps browser data hidden below /var/lib while restoring only its uploads", () => {
    expect(layout("browser")).toEqual(["hidden", "hidden", "upload fixture"]);
  });

  it("hides data through its symlink and real path while preserving the turn's workspace", () => {
    expect(layout("symlink")).toEqual({ botId: "bot-a", files: ["hidden", "hidden", "task fixture", "memory fixture"] });
  });
});
