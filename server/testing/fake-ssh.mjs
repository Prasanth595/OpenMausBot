#!/usr/bin/env node
// A stand-in for `ssh -T … -R 127.0.0.1:<remote>:127.0.0.1:<local> <alias> -- <command>`: it listens on the "remote" port
// here, pipes each connection to the local port, and runs the command in a shell with the caller's stdio.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import net from "node:net";

const args = process.argv.slice(2);
let forward = null;
let alias = null;
let command = null;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--") { command = args.slice(i + 1).join(" "); break; }
  if (arg === "-F" || arg === "-o") { i++; continue; }
  if (arg === "-R") { forward = args[++i]; continue; }
  if (!arg.startsWith("-")) alias = arg;
}
if (process.env.FAKE_SSH_LOG) appendFileSync(process.env.FAKE_SSH_LOG, `${JSON.stringify({ alias, forward, command })}\n`);
if (!command) process.exit(255);

let server = null;
if (forward) {
  const [, remotePort, , localPort] = forward.split(":");
  server = net.createServer((remote) => {
    const local = net.connect(Number(localPort), "127.0.0.1");
    remote.pipe(local);
    local.pipe(remote);
    remote.on("error", () => local.destroy());
    local.on("error", () => remote.destroy());
  });
  server.on("error", (error) => { console.error(`remote port forwarding failed for listen port ${remotePort}: ${error.message}`); process.exit(255); });
  server.listen(Number(remotePort), "127.0.0.1");
}

// The host has its own PATH; this process's is whatever the fixture gave the harness.
const child = spawn("/bin/sh", ["-c", command], { stdio: "inherit", env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin` } });
child.on("error", (error) => { console.error(`fake ssh: ${error.message}`); process.exit(255); });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  server?.close();
  process.exit(code ?? (signal ? 128 : 0));
});
