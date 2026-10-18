import { rootClient } from "@rootsdk/client-app";

/**
 * Root refuses more than 10 requests per second from one client. Opening a
 * project fires many at once (project, tabs, fields, texts, names…), so
 * every service request goes through this queue: at most MAX_PER_SECOND,
 * leaving room for Root's own calls, with a retry if Root still says no.
 */
const MAX_PER_SECOND = 6;
const WINDOW_MS = 1000;
const RETRIES = 3;

type Send = (path: string, request: unknown, method: unknown) => Promise<unknown>;

const sent: number[] = [];
let queue: Promise<void> = Promise.resolve();

function slot(): Promise<void> {
  // Chained so requests leave in order, one slot at a time.
  const next = queue.then(async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= WINDOW_MS) sent.shift();
      if (sent.length < MAX_PER_SECOND) {
        sent.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, WINDOW_MS - (now - sent[0]) + 5));
    }
  });
  queue = next;
  return next;
}

/** Runs another Root call (profiles, assets) through the same queue. */
export async function throttled<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await slot();
    try {
      return await call();
    } catch (err) {
      if (!isRateLimitError(err) || attempt >= RETRIES) throw err;
      await new Promise((r) => setTimeout(r, WINDOW_MS * (attempt + 1)));
    }
  }
}

export function isRateLimitError(err: unknown): boolean {
  return /rate limit/i.test(String((err as Error)?.message ?? err));
}

const client = rootClient as unknown as { sendWithResponse: Send; __rateLimited?: boolean };
if (typeof client.sendWithResponse === "function" && !client.__rateLimited) {
  const original = client.sendWithResponse.bind(rootClient);
  client.sendWithResponse = async (path, request, method) => {
    for (let attempt = 0; ; attempt++) {
      await slot();
      try {
        return await original(path, request, method);
      } catch (err) {
        if (!isRateLimitError(err) || attempt >= RETRIES) throw err;
        await new Promise((r) => setTimeout(r, WINDOW_MS * (attempt + 1)));
      }
    }
  };
  client.__rateLimited = true;
}

