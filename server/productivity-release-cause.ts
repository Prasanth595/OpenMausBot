// Why a production release failed, as the productivity report shows it: the
// release log's own verdict line, without what changes on every try (log
// paths, time stamps, pids, hashes), so one failure repeated reads as one.

// ESC [ … m, built from a string so no control character sits in a regex literal
const ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The last line saying why, from a failed run's tail. */
export function releaseFailureCause(outTail: string): string | null {
  // ANSI colours out; a workspace's test output (@scope/pkg:test: …) is never the cause
  const lines = outTail.split("\n").map((line) => line.replace(ANSI_COLOUR, "").trim()).filter((line) => line && !/@[\w.-]+\/[\w.-]+:test:/.test(line));
  // the release's own verdict: the first [ERROR] of the block that ends in "Release aborted"
  const abort = lines.findLastIndex((line) => /Release abortado|Release aborted/i.test(line));
  if (abort >= 0) {
    let start = abort;
    while (start > 0 && /\[ERROR\]/.test(lines[start - 1]!)) start -= 1;
    if (start < abort) return lines[start]!.replace(/^\[ERROR\]\s*/, "").slice(0, 300);
  }
  const named = lines.findLast((line) => /Release snapshot changed|ADMISSION_(?:TIMEOUT|STOPPED|NESTED_REFUSED)\b|Local CI failed at/.test(line))
    ?? lines.findLast((line) => /\[ERROR\]/.test(line));
  return named ? named.replace(/^\[ERROR\]\s*/, "").slice(0, 300) : null;
}

/** A cause as shown and compared across tries: what failed, without the log
 * path, absolute paths, time stamps, pids or hashes. */
export function releaseCauseShown(cause: string): string {
  return cause
    .replace(/\s*\b(?:Logs?|Log file|See|Veja)\s*:\s*\S+/gi, "")
    // a path as a field's value (dir=/tmp/adm.5RILoB) keeps the field
    .replace(/(^|\s|=)(?:\/[\w.@+-]+)+\/?/g, (_path, before: string) => (before === "=" ? "=" : " "))
    .replace(/\b\d{8}T\d{6}Z?\b|\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?Z?\b|\b\d{1,2}:\d{2}(?::\d{2})?\b/g, "")
    .replace(/\bpids?[ =:]+\d+\b/gi, "")
    .replace(/\b(\w+_pid)=\d+\b/g, "$1")
    .replace(/\bblocked_by=\S*/g, "blocked_by")
    .replace(/\s+(?:holder|held|counted)=\S*/g, "")
    .replace(/\b(Job|group|process)\s+\d+\b/gi, "$1")
    .replace(/\b(waited|elapsed|after)[=: ]+\d+(?:\.\d+)?(?:\s*(?:ms|s|m|min)\b)?/gi, "$1")
    .replace(/\b[0-9a-f]{12,40}\b/g, "")
    .replace(/[\s.,;:-]+$/u, "")
    .replace(/\s+(?:at|on)$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}
