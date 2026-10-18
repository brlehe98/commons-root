import { useEffect, useRef } from "react";

/**
 * The phone's back button (and the browser's) closes what is open, newest
 * first: a project, the side panel, Settings… While anything is open, one
 * extra step sits in the page history; going back takes that step, closes the
 * newest layer, and puts the step back if more layers remain.
 */
type Layer = { onBack: () => void };
const layers: Layer[] = [];
let stepAdded = false;
// Steps the app removed itself, whose popstate must not close anything.
let ignoring = 0;
let pending = 0;

/** Adds or removes the extra step to match the open layers, once the dust settles. */
function reconcile() {
  window.clearTimeout(pending);
  pending = window.setTimeout(() => {
    try {
      if (layers.length && !stepAdded) {
        history.pushState({ commonsLayer: true }, "");
        stepAdded = true;
      } else if (!layers.length && stepAdded) {
        stepAdded = false;
        ignoring++;
        history.back();
      }
    } catch {
      // A sandboxed frame may refuse; the on-screen arrows still work.
    }
  }, 0);
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    if (ignoring > 0) {
      ignoring--;
      return;
    }
    if (!stepAdded) return;
    stepAdded = false;
    layers.pop()?.onBack();
    reconcile();
  });
}

/** While `open`, the back button calls `onBack` instead of leaving the app. */
export function useBackButton(open: boolean, onBack: () => void) {
  const latest = useRef(onBack);
  latest.current = onBack;
  useEffect(() => {
    if (!open || typeof window === "undefined") return;
    const layer: Layer = { onBack: () => latest.current() };
    layers.push(layer);
    reconcile();
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
      reconcile();
    };
  }, [open]);
}
