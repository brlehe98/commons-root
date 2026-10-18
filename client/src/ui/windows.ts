import { useSyncExternalStore } from "react";

/**
 * The project's tool windows (style guide, checklist). They open and close
 * from their button; one is open at a time, always in the same place, so
 * opening one closes the other.
 */
export type WindowView = "closed" | "open";
export type WindowId = "styleguide" | "checklist";
type State = { views: Partial<Record<WindowId, WindowView>> };

let state: State = { views: {} };
const listeners = new Set<() => void>();

function set(next: State) {
  state = next;
  listeners.forEach((l) => l());
}

export function openWindow(id: WindowId) {
  set({ views: { [id]: "open" } });
}

/** Opens a window, or closes it when it is the open one. */
export function toggleWindow(id: WindowId) {
  if (state.views[id] === "open") closeWindow(id);
  else openWindow(id);
}

export function closeWindow(id: WindowId) {
  set({ views: { ...state.views, [id]: "closed" } });
}

/** Closes every window, when the project closes. */
export function closeAllWindows() {
  set({ views: {} });
}

export function useWindows(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

export const viewOf = (s: State, id: WindowId): WindowView => s.views[id] ?? "closed";

/** Where the open window sits: bottom right (full width on a phone, see design.css). */
export function windowPlace(): { right: number; raised: boolean } {
  const narrow = typeof window !== "undefined" && window.innerWidth <= 600;
  return { right: narrow ? 8 : 20, raised: false };
}
