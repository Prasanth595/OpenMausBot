import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BotBox } from "../bot-box/box.ts";
import { bwrapArgs, planBox, type BoxRequest } from "../bot-box/plan.ts";

const scenario = process.argv[2];
const realData = "/var/lib/openmausbot";
const home = "/home/fixture";
mkdirSync(realData, { recursive: true });
mkdirSync(home, { recursive: true });
writeFileSync(join(realData, "messages.db"), "private fixture");

const probe = (options: string[], script: string, seccomp?: string | null) => {
  const fd = seccomp ? openSync(seccomp, "r") : null;
  try {
    const result = spawnSync("/usr/bin/bwrap", [...options, "--", "/bin/sh", "-c", script],
      { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe", ...(fd === null ? [] : [fd])] });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim().split("\n");
  } finally { if (fd !== null) closeSync(fd); }
};
const setup = { dataDir: realData, home, codeRoots: [], engineRoots: [], bridges: [] };
const request: BoxRequest = { command: "/bin/sh", args: [], env: {}, net: "shared" };

if (scenario === "browser" || scenario === "browser-read-only") {
  const uploads = scenario === "browser" ? "/srv/browser-uploads" : join(realData, "browser-uploads");
  mkdirSync(uploads);
  writeFileSync(join(uploads, "upload.txt"), "upload fixture");
  writeFileSync(join(home, "private.txt"), "home fixture");
  const box = new BotBox();
  try {
    await box.start({ ...setup, port: 8799, denyEnv: new Set(), env: {}, log: () => {},
      detect: () => ({ box: "bwrap", reason: null, tools: { bwrap: "/usr/bin/bwrap", socat: null } }) });
    const browser = box.browserBox(3, [uploads])!;
    console.log(JSON.stringify(probe(browser.options,
      `for file in /var/lib/openmausbot/messages.db /home/fixture/private.txt; do if test -r "$file"; then echo exposed; else echo hidden; fi; done; cat ${uploads}/upload.txt`, browser.seccomp)));
  } finally { await box.stop(); }
} else if (scenario === "symlink") {
  symlinkSync(realData, "/srv/omb");
  const cwd = "/srv/omb/task-workspaces/bot-a/thread-1";
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "task.txt"), "task fixture\n");
  mkdirSync(join(realData, "workspaces", "bot-a"), { recursive: true });
  writeFileSync(join(realData, "workspaces", "bot-a", "memory.txt"), "memory fixture\n");
  const plan = planBox({ ...setup, dataDir: "/srv/omb" }, { ...request, cwd });
  console.log(JSON.stringify({ botId: plan.botId, files: probe(bwrapArgs(plan),
    'for file in /srv/omb/messages.db /var/lib/openmausbot/messages.db; do if test -r "$file"; then echo exposed; else echo hidden; fi; done; cat task.txt; cat /var/lib/openmausbot/workspaces/bot-a/memory.txt') }));
} else if (scenario === "read-only") {
  const skills = join(realData, "claude-user-skills");
  mkdirSync(skills);
  writeFileSync(join(skills, "skill.txt"), "skill fixture\n");
  const plan = planBox(setup, { ...request, args: ["--add-dir", skills] });
  console.log(JSON.stringify(probe(bwrapArgs(plan),
    'cat /var/lib/openmausbot/claude-user-skills/skill.txt; if (echo changed > /var/lib/openmausbot/claude-user-skills/skill.txt) 2>/dev/null; then echo writable; else echo read-only; fi; if test -r /var/lib/openmausbot/messages.db; then echo exposed; else echo hidden; fi')));
} else throw new Error("Unknown mount fixture");
