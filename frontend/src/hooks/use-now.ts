import { useSyncExternalStore } from "react";

// One shared clock for relative times. The snapshot changes once per
// minute, so components re-render at most once a minute, and the timer only
// runs while something is subscribed.
const STEP_MS = 60_000;
const TICK_MS = 10_000;
const listeners = new Set<() => void>();
let timer: number | undefined;

function getSnapshot(): number {
  return Math.ceil(Date.now() / STEP_MS) * STEP_MS;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  timer ??= window.setInterval(() => {
    for (const listener of listeners) listener();
  }, TICK_MS);

  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
