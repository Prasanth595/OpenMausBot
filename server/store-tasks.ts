import type { BotRecord } from "./store.ts";

export function persistedPin<T extends { pinned?: boolean }>(task: T): T {
  if (task.pinned === true) return task;
  if (!("pinned" in task)) return task;
  const { pinned: _pinned, ...rest } = task;
  return rest as T;
}

export function backfillPrivateTasks(bots: readonly BotRecord[], destinations: readonly { botId: string; threadId: string }[], save: () => void): void {
  const byBot = new Map<string, Set<string>>();
  for (const { botId, threadId } of destinations) {
    let threads = byBot.get(botId);
    if (!threads) byBot.set(botId, threads = new Set());
    threads.add(threadId);
  }
  let dirty = false;
  for (const bot of bots) {
    const threads = byBot.get(bot.id);
    if (!threads) continue;
    for (const task of bot.tasks ?? []) {
      if (task.private || !threads.has(task.threadId)) continue;
      task.private = true;
      dirty = true;
    }
  }
  if (!dirty) return;
  // Keep the denial in memory even when the registry cannot persist it.
  try { save(); } catch (error) {
    console.warn(`private threads: could not save bots.json: ${error instanceof Error ? error.message : String(error)}`);
  }
}
