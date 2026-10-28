import type { JournalEntry } from "./driver-wire.ts";

export interface JournalScope { botId: string; threadId: string; generation: string }
export type JournalCapability = JournalScope & { kind: string; localVmTarget?: unknown; boxId?: string | null; teamComputerId?: string };

export function hostScope(capability: JournalCapability): JournalScope | null {
  if (capability.kind !== "computer" || capability.localVmTarget || capability.boxId !== undefined || capability.teamComputerId) return null;
  return { botId: capability.botId, threadId: capability.threadId, generation: capability.generation };
}

const TOOL_NAME = /^[a-z_][a-z0-9_]{0,63}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseJournalEntry(body: unknown): JournalEntry | null {
  if (!isPlainObject(body)) return null;
  const { tool, arguments: args, result } = body;
  if (typeof tool !== "string" || !TOOL_NAME.test(tool)) return null;
  if (!isPlainObject(args) || !isPlainObject(result) || typeof result.isError !== "boolean") return null;
  return { tool, arguments: args, result: result as unknown as JournalEntry["result"] };
}

export interface RecordedCall extends JournalEntry { generation: string }
export interface RequestJournal { calls: RecordedCall[]; complete: boolean; tainted: boolean }

interface ThreadJournal {
  calls: RecordedCall[];
  checks: Map<string, number>;
  recorded: Map<string, number>;
  tainted: Set<string>;
  overflow: Set<string>;
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

const emptyThread = (): ThreadJournal => ({ calls: [], checks: new Map(), recorded: new Map(), tainted: new Set(), overflow: new Set() });

export class ComputerJournal {
  private readonly threads = new Map<string, ThreadJournal>();
  private readonly evicted = new Map<string, Set<string>>();
  private readonly callsPerThread: number;
  private readonly maxThreads: number;
  private readonly maxEvicted: number;

  constructor(limits: { callsPerThread?: number; threads?: number; evictedThreads?: number } = {}) {
    this.callsPerThread = limits.callsPerThread ?? 400;
    this.maxThreads = limits.threads ?? 64;
    this.maxEvicted = limits.evictedThreads ?? 1024;
  }

  private thread(threadId: string): ThreadJournal {
    let found = this.threads.get(threadId);
    if (found) return found;
    found = emptyThread();
    this.threads.set(threadId, found);
    while (this.threads.size > this.maxThreads) {
      const [oldest, journal] = this.threads.entries().next().value!;
      this.threads.delete(oldest);
      this.evict(oldest, journal);
    }
    return found;
  }

  private evict(threadId: string, journal: ThreadJournal): void {
    const lost = this.evicted.get(threadId) ?? new Set<string>();
    for (const generation of [...journal.checks.keys(), ...journal.recorded.keys(), ...journal.tainted]) lost.add(generation);
    this.evicted.delete(threadId);
    this.evicted.set(threadId, lost);
    while (this.evicted.size > this.maxEvicted) this.evicted.delete(this.evicted.keys().next().value as string);
  }

  gateChecked(scope: JournalScope): void {
    bump(this.thread(scope.threadId).checks, scope.generation);
  }

  record(scope: JournalScope, entry: JournalEntry): void {
    const thread = this.thread(scope.threadId);
    bump(thread.recorded, scope.generation);
    if (thread.calls.length >= this.callsPerThread) thread.overflow.add(scope.generation);
    else thread.calls.push({ ...entry, generation: scope.generation });
  }

  taint(scope: Pick<JournalScope, "threadId" | "generation">): void {
    this.thread(scope.threadId).tainted.add(scope.generation);
  }

  take(threadId: string, generations: ReadonlySet<string>): RequestJournal | null {
    const thread = this.threads.get(threadId) ?? emptyThread();
    const lost = this.evicted.get(threadId) ?? new Set<string>();
    this.threads.delete(threadId);
    this.evicted.delete(threadId);
    const seen = new Set<string>();
    for (const map of [thread.checks, thread.recorded]) for (const generation of map.keys()) if (generations.has(generation)) seen.add(generation);
    for (const generation of [...thread.tainted, ...lost]) if (generations.has(generation)) seen.add(generation);
    if (seen.size === 0) return null;
    let complete = true;
    let tainted = false;
    for (const generation of seen) {
      if ((thread.checks.get(generation) ?? 0) !== (thread.recorded.get(generation) ?? 0) || thread.overflow.has(generation) || lost.has(generation)) complete = false;
      if (thread.tainted.has(generation) || lost.has(generation)) tainted = true;
    }
    return { calls: thread.calls.filter((call) => generations.has(call.generation)), complete, tainted };
  }
}
