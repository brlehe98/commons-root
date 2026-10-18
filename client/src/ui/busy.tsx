import { useEffect, useSyncExternalStore } from "react";

// A thin bar at the top while something shown from a saved copy refreshes.

let count = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** Shows the bar while `on` is true. */
export function useBusy(on: boolean) {
  useEffect(() => {
    if (!on) return;
    count++;
    emit();
    return () => {
      count--;
      emit();
    };
  }, [on]);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};

export function BusyBar() {
  const busy = useSyncExternalStore(subscribe, () => count > 0);
  return busy ? <div className="busy-bar" role="progressbar" aria-busy="true" /> : null;
}
