import { rootClient } from "@rootsdk/client-app";

/**
 * The last copy seen of the board, projects, tab lists and texts, kept on
 * the device. Reopening one shows it at once while the fresh copy loads,
 * instead of a blank "Loading…", even after the phone dropped the app.
 * Per member, a week at most, and only the most recent entries.
 */
const DB_NAME = "commons-snapshots";
const STORE = "snapshots";
const MAX_ENTRIES = 60;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Raised when saved data changes shape, so copies from an older version are ignored.
const SHAPE = 2;

type Entry = { key: string; value: unknown; at: number };

const memory = new Map<string, Entry>();
let db: IDBDatabase | null = null;

function scoped(key: string): string {
  let user = "";
  try {
    user = rootClient.users.getCurrentUserId();
  } catch {
    // No member yet (tests): one shared scope.
  }
  return `v${SHAPE}:${user}:${key}`;
}

function request<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Reads the saved copies into memory. Never fails, and gives up after `timeoutMs`. */
export function loadSnapshots(timeoutMs = 800): Promise<void> {
  const load = (async () => {
    if (typeof indexedDB === "undefined") return;
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "key" });
    db = await request(open);
    const entries = (await request(db.transaction(STORE).objectStore(STORE).getAll())) as Entry[];
    const now = Date.now();
    for (const e of entries) {
      if (now - e.at < MAX_AGE_MS) memory.set(e.key, e);
      else void drop(e.key);
    }
  })().catch((err) => console.warn("Saved copies unavailable:", err));
  return Promise.race([load, new Promise<void>((r) => setTimeout(r, timeoutMs))]);
}

function drop(fullKey: string) {
  memory.delete(fullKey);
  try {
    db?.transaction(STORE, "readwrite").objectStore(STORE).delete(fullKey);
  } catch {
    // Storage gone: the memory copy is what counts.
  }
}

export function recall<T>(key: string): T | undefined {
  return memory.get(scoped(key))?.value as T | undefined;
}

export function remember(key: string, value: unknown) {
  const entry: Entry = { key: scoped(key), value, at: Date.now() };
  memory.delete(entry.key);
  memory.set(entry.key, entry);
  try {
    db?.transaction(STORE, "readwrite").objectStore(STORE).put(entry);
  } catch (err) {
    console.warn("Could not save a copy:", err);
  }
  // Oldest first in a Map: trim from the front.
  while (memory.size > MAX_ENTRIES) drop(memory.keys().next().value!);
}

export function forget(key: string) {
  drop(scoped(key));
}
