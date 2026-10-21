// Per-member limits on expensive or noisy actions. The member is the Root
// user id that Root attaches to each call, so a client cannot spoof it the
// way a forwarded IP header could be. Root itself caps a client at about 10
// requests per second; these limits sit on top for specific actions.

type Limit = { max: number; windowMs: number };

const MINUTE = 60 * 1000;
export const LIMITS = {
  // Each saved version stores a full snapshot of the text.
  saveVersion: { max: 30, windowMs: MINUTE },
  // Each stored photo or attachment is a file in Root's asset store.
  commitPhoto: { max: 20, windowMs: MINUTE },
  createPage: { max: 30, windowMs: MINUTE },
  // Each publication stores the whole page.
  publish: { max: 20, windowMs: MINUTE },
  // Reports notify the space's editors.
  sendReport: { max: 10, windowMs: MINUTE },
  // Comments, mentions and suggestions send notifications to other members.
  reportActivity: { max: 60, windowMs: MINUTE },
  // Searching scans the published texts.
  search: { max: 60, windowMs: MINUTE },
  // Each name color looks up the member's roles in Root.
  nameColors: { max: 60, windowMs: MINUTE },
} satisfies Record<string, Limit>;

export type LimitedAction = keyof typeof LIMITS;

export class RateLimitError extends Error {}

const hits = new Map<string, number[]>();
let lastSweep = Date.now();

/** Throws when this member did this action too often in its window. */
export function rateLimit(userId: string, action: LimitedAction, now = Date.now()) {
  const { max, windowMs } = LIMITS[action];
  const key = `${action}/${userId}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    hits.set(key, recent);
    throw new RateLimitError("Too many requests in a short time. Wait a moment and try again.");
  }
  recent.push(now);
  hits.set(key, recent);
  // Forget idle members now and then so the map stays small.
  if (now - lastSweep > 10 * MINUTE) {
    lastSweep = now;
    for (const [k, times] of hits) if (!times.some((t) => now - t < 10 * MINUTE)) hits.delete(k);
  }
}
