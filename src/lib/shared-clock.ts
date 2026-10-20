/** One 1-second clock for every working timer on screen: N timers, one interval (none when nothing listens). */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

export function onSecond(listener: () => void): () => void {
  listeners.add(listener);
  timer ??= setInterval(() => { for (const fn of [...listeners]) fn(); }, 1000);
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) { clearInterval(timer); timer = null; }
  };
}

export const sharedClockListeners = () => listeners.size;
