import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useBackButton } from "../ui/backButton";

/** Where the reader is. A page opens on a tab: read, edit or history. */
export type Route =
  | { view: "space"; spaceId: string; at?: SpaceAt }
  | { view: "search"; query: string; spaceId?: string }
  | { view: "reports"; pageId?: string }
  | { view: "settings"; section?: string };

export type SpaceAt =
  | { kind: "home" }
  | { kind: "page"; pageId: string; tab?: "read" | "edit" | "history"; revisionId?: string; section?: { index: number; text: string } }
  | { kind: "recent" }
  | { kind: "category"; categoryId: string }
  | { kind: "tag"; tag: string }
  | { kind: "tags" }
  | { kind: "drafts" };

type Nav = {
  route: Route;
  /** Opens a new place; the back button returns here. */
  go: (route: Route) => void;
  /** Changes the current place without a step back (a tab of the same page). */
  replace: (route: Route) => void;
  back: () => void;
  canGoBack: boolean;
};

const NavContext = createContext<Nav | null>(null);

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error("useNav outside NavProvider");
  return nav;
}

const same = (a: Route, b: Route) => JSON.stringify(a) === JSON.stringify(b);
// Enough to walk back through a reading session, not every page ever opened.
const MAX_STEPS = 50;

export const NavProvider: React.FC<{ initial: Route; children: React.ReactNode }> = ({ initial, children }) => {
  const [stack, setStack] = useState<Route[]>([initial]);
  const route = stack[stack.length - 1];
  const go = useCallback((next: Route) => {
    setStack((s) => (same(s[s.length - 1], next) ? s : [...s, next].slice(-MAX_STEPS)));
    window.scrollTo?.(0, 0);
  }, []);
  const replace = useCallback((next: Route) => setStack((s) => [...s.slice(0, -1), next]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  // The phone's back button walks back through the places opened.
  useBackButton(stack.length > 1, back);
  const value = useMemo(() => ({ route, go, replace, back, canGoBack: stack.length > 1 }), [route, go, replace, back, stack.length]);
  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
};

/** A link inside the app: a real anchor (middle-click aside), opened by the router. */
export const NavLink: React.FC<{ to: Route; className?: string; title?: string; children: React.ReactNode }> = ({ to, className, title, children }) => {
  const { go } = useNav();
  return (
    <a
      href="#"
      className={className}
      title={title}
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
    >
      {children}
    </a>
  );
};

export const pageRoute = (spaceId: string, pageId: string, tab?: "read" | "edit" | "history"): Route => ({
  view: "space",
  spaceId,
  at: { kind: "page", pageId, tab },
});
