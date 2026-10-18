/**
 * Where the reader was, so a trip out of the app (answering a message in
 * Root) brings them back to the same page instead of the home page.
 * Forgotten after a while: the next morning starts fresh.
 */
const KEY = "commons.resume";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export type Resume = {
  /** The place last open (a wiki Route). */
  route?: unknown;
  at: number;
};

export function readResume(): Resume | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Resume | null;
    return saved && Date.now() - saved.at < MAX_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

/** Merges `change` into what is remembered; `undefined` values forget a part. */
export function saveResume(change: Partial<Omit<Resume, "at">>) {
  try {
    const next = { ...(readResume() ?? {}), ...change, at: Date.now() };
    for (const k of Object.keys(change) as (keyof typeof change)[]) if (change[k] === undefined) delete next[k];
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage can be unavailable; the app just starts on the home page.
  }
}
