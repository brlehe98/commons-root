import { useCallback, useState } from "react";

/** Below this width a side panel starts closed and opens over the text. */
export const NARROW_PX = 900;

export function isNarrow(): boolean {
  return typeof window !== "undefined" && window.innerWidth < NARROW_PX;
}

/**
 * Open/closed state of a side panel, remembered per viewer in this
 * browser. On a narrow screen it always starts closed.
 */
export function usePanel(key: string, openByDefault = true): [boolean, (open: boolean) => void] {
  const [open, setOpenState] = useState(() => {
    if (isNarrow()) return false;
    try {
      const saved = localStorage.getItem(key);
      return saved === null ? openByDefault : saved === "1";
    } catch {
      return openByDefault;
    }
  });
  const setOpen = useCallback(
    (next: boolean) => {
      setOpenState(next);
      // Only desktop choices are remembered; a phone always starts closed.
      if (isNarrow()) return;
      try {
        localStorage.setItem(key, next ? "1" : "0");
      } catch {
        // Storage can be unavailable; the choice just isn't remembered.
      }
    },
    [key],
  );
  return [open, setOpen];
}
