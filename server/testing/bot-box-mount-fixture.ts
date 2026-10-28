import { spawnSync } from "node:child_process";
import { closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BotBox } from "../bot-box/box.ts";

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

if (scenario === "browser") {
  const uploads = "/srv/browser-uploads";
  mkdirSync(uploads);
  writeFileSync(join(uploads, "upload.txt"), "upload fixture");
  writeFileSync(join(home, "private.txt"), "home fixture");
  const box = new BotBox();
  try {
    await box.start({ ...setup, port: 8799, denyEnv: new Set(), env: {}, log: () => {},
      detect: () => ({ box: "bwrap", reason: null, tools: { bwrap: "/usr/bin/bwrap", socat: null } }) });
    const browser = box.browserBox(3, [uploads])!;
    console.log(JSON.stringify(probe(browser.options,
      'for file in /var/lib/openmausbot/messages.db /home/fixture/private.txt; do if test -r "$file"; then echo exposed; else echo hidden; fi; done; cat /srv/browser-uploads/upload.txt', browser.seccomp)));
  } finally { await box.stop(); }
} else throw new Error("Unknown mount fixture");
