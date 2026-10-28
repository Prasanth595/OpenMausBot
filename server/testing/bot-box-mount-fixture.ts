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
} else if (scenario === "symlink" || scenario === "symlink-home") {
  const alias = scenario === "symlink" ? "/srv/omb" : "/srv/linked-home/openmausbot";
  const boxHome = scenario === "symlink" ? "/srv" : "/srv/linked-home";
  if (scenario === "symlink") symlinkSync(realData, alias);
  else symlinkSync("/var/lib", boxHome);
  const cwd = join(alias, "task-workspaces", "bot-a", "thread-1");
  mkdirSync(cwd, { recursive: true });
  writeFileSync(join(cwd, "task.txt"), "task fixture\n");
  mkdirSync(join(realData, "workspaces", "bot-a"), { recursive: true });
  writeFileSync(join(realData, "workspaces", "bot-a", "memory.txt"), "memory fixture\n");
  const plan = planBox({ ...setup, dataDir: alias, home: boxHome }, { ...request, cwd });
  console.log(JSON.stringify({ botId: plan.botId, files: probe(bwrapArgs(plan),
    `for file in ${alias}/messages.db /var/lib/openmausbot/messages.db; do if test -r "$file"; then echo exposed; else echo hidden; fi; done; cat task.txt; cat /var/lib/openmausbot/workspaces/bot-a/memory.txt`) }));
} else if (scenario === "read-only") {
  const skills = join(realData, "claude-user-skills");
  mkdirSync(skills);
  writeFileSync(join(skills, "skill.txt"), "skill fixture\n");
  const plan = planBox(setup, { ...request, args: ["--add-dir", skills] });
  console.log(JSON.stringify(probe(bwrapArgs(plan),
    'cat /var/lib/openmausbot/claude-user-skills/skill.txt; if (echo changed > /var/lib/openmausbot/claude-user-skills/skill.txt) 2>/dev/null; then echo writable; else echo read-only; fi; if test -r /var/lib/openmausbot/messages.db; then echo exposed; else echo hidden; fi')));
} else if (scenario === "home") {
  const results: unknown[] = [];
  for (const ownHome of ["/srv/omb/home", "/srv/omb"]) {
    mkdirSync(join(ownHome, ".claude"), { recursive: true });
    writeFileSync(join(ownHome, ".claude", "settings.json"), "settings fixture\n");
    writeFileSync("/srv/omb/messages.db", "private fixture");
    try {
      const plan = planBox({ ...setup, dataDir: "/srv/omb", home: ownHome }, { ...request, env: { HOME: ownHome } });
      results.push({ files: probe(bwrapArgs(plan),
        `if test -r ${ownHome}/.claude/settings.json; then cat ${ownHome}/.claude/settings.json; else echo missing; fi; if (echo changed > ${ownHome}/.claude/settings.json) 2>/dev/null; then echo writable; else echo unwritable; fi; if test -r /srv/omb/messages.db; then echo exposed; else echo hidden; fi`) });
    } catch (error) { results.push({ error: (error as Error).message }); }
  }
  try {
    const audience = planBox({ ...setup, dataDir: "/srv/omb" }, { ...request, home: "/srv/omb" });
    results.push({ files: probe(bwrapArgs(audience), 'if test -r /srv/omb/messages.db; then echo exposed; else echo hidden; fi') });
  } catch (error) { results.push({ error: (error as Error).message }); }
  const browser = planBox({ ...setup, dataDir: "/srv/omb", home: "/srv/omb" }, { ...request, home: false });
  results.push(probe(bwrapArgs(browser), 'if test -r /srv/omb/messages.db; then echo exposed; else echo hidden; fi'));
  console.log(JSON.stringify(results));
} else throw new Error("Unknown mount fixture");
