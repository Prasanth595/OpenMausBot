import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("isolates checkpoint capture and drains complete large frames before exit", () => {
  const dir = mkdtempSync(join(tmpdir(), "omb-fake-stdin-"));
  try {
    const prompt = "Produce a checkpoint for continuing the same task.\n" + JSON.stringify({
      id: "source-1", role: "user", sourceKind: "user", text: "日本語の要件 🧪" + "🐭".repeat(30_000),
    });
    const bytes = Buffer.from(prompt), split = bytes.indexOf(Buffer.from("日")) + 1;
    const preload = join(dir, "stdin.mjs"), dump = join(dir, "ordinary-dump.json");
    const checkpointEvidence = join(dir, "checkpoint-evidence.jsonl"), settings = join(dir, "settings.json");
    writeFileSync(settings, "{}");
    writeFileSync(dump, "ordinary turn capture");
    writeFileSync(preload, [
      "import { Readable } from 'node:stream';",
      "const parts = " + JSON.stringify([bytes.subarray(0, split).toString("hex"), bytes.subarray(split).toString("hex")]) + ";",
      "const input = Readable.from((async function* () {",
      "  for (const part of parts) { yield Buffer.from(part, 'hex'); await new Promise(setImmediate); }",
      "})(), { objectMode: false, highWaterMark: 1 });",
      "Object.defineProperty(process, 'stdin', { value: input });",
    ].join("\n"));
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload,
      fileURLToPath(new URL("./fake-claude-cli.ts", import.meta.url)), "--output-format", "stream-json", "--no-session-persistence", "--settings", settings], {
      env: { PATH: process.env.PATH, HOME: dir, USERPROFILE: dir, FAKE_CLAUDE_DUMP: dump, FAKE_CLAUDE_CHECKPOINT_EVIDENCE: checkpointEvidence },
      encoding: "utf8", timeout: 10_000, maxBuffer: 2_000_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(dump, "utf8")).toBe("ordinary turn capture");
    expect(JSON.parse(readFileSync(checkpointEvidence, "utf8").trim()).prompt).toBe(prompt);
    const frames = result.stdout.trimEnd().split("\n").map(line => JSON.parse(line));
    expect(frames.map(frame => frame.type)).toEqual(["system", "stream_event", "assistant", "result"]);
    expect(frames[2].message.content[0].text).toBe(frames[3].result);
    expect(frames[3].result.length).toBeGreaterThan(100_000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
