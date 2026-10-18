import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import zlib from "zlib";
import { get, run } from "./db";

const SAVE_DELAY_MS = 2000;
// An automatic version is kept at most this often while a document changes.
const VERSION_INTERVAL_MS = 10 * 60 * 1000;

export type LiveDoc = {
  id: string;
  ydoc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  // Awareness client ids announced by each Root device, so a device that
  // leaves can have its cursor removed.
  awarenessByDevice: Map<string, Set<number>>;
  saveTimer?: NodeJS.Timeout;
  lastVersionAt: number;
};

const docs = new Map<string, Promise<LiveDoc>>();
// When each document was last asked for. An open editor asks at least every
// 30 seconds, so one idle this long has nobody on it.
const lastUsed = new Map<string, number>();
const IDLE_MS = 20 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;

export function getDoc(id: string): Promise<LiveDoc> {
  lastUsed.set(id, Date.now());
  let doc = docs.get(id);
  if (!doc) {
    doc = loadDoc(id);
    docs.set(id, doc);
    // A failed load is retried on the next request rather than kept.
    doc.catch(() => docs.get(id) === doc && docs.delete(id));
  }
  return doc;
}

/** Saves and unloads the documents nobody has used for a while, so memory stays flat. */
async function sweep() {
  const now = Date.now();
  for (const [id, live] of Array.from(docs)) {
    const used = lastUsed.get(id) ?? 0;
    if (now - used < IDLE_MS) continue;
    try {
      const doc = await live;
      if (doc.saveTimer) {
        clearTimeout(doc.saveTimer);
        doc.saveTimer = undefined;
        await saveDoc(doc);
      }
      // Asked for again while saving: keep it.
      if (docs.get(id) !== live || lastUsed.get(id) !== used) continue;
      docs.delete(id);
      lastUsed.delete(id);
      doc.awareness.destroy();
      doc.ydoc.destroy();
    } catch (err) {
      console.error("Could not unload document", id, err);
    }
  }
}
setInterval(() => void sweep(), SWEEP_MS).unref();

export function liveDocs(): Promise<LiveDoc[]> {
  return Promise.all(docs.values());
}

async function loadDoc(id: string): Promise<LiveDoc> {
  const ydoc = new Y.Doc();
  const row = await get<{ state: Buffer; compressed: number }>("SELECT state, compressed FROM docs WHERE id = ?", [id]);
  // Documents in the final archive are stored gzipped.
  if (row) Y.applyUpdate(ydoc, new Uint8Array(row.compressed ? zlib.gunzipSync(row.state) : row.state));

  const awareness = new awarenessProtocol.Awareness(ydoc);
  // The server has no cursor of its own.
  awareness.setLocalState(null);

  const live: LiveDoc = { id, ydoc, awareness, awarenessByDevice: new Map(), lastVersionAt: Date.now() };
  ydoc.on("update", () => scheduleSave(live));
  return live;
}

function scheduleSave(doc: LiveDoc) {
  if (doc.saveTimer) return;
  doc.saveTimer = setTimeout(() => {
    doc.saveTimer = undefined;
    saveDoc(doc).catch((err) => console.error("saveDoc failed", doc.id, err));
  }, SAVE_DELAY_MS);
}

async function saveDoc(doc: LiveDoc) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc.ydoc));
  const now = Date.now();
  await run(
    "INSERT INTO docs (id, state, updated_at, compressed) VALUES (?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at, compressed = 0",
    [doc.id, state, now],
  );
  // A page whose draft changed has something new to publish.
  if (doc.id.startsWith("page:"))
    await run("UPDATE pages SET draft_changed = 1, updated_at = ? WHERE id = ?", [now, doc.id.slice("page:".length)]);
  if (now - doc.lastVersionAt >= VERSION_INTERVAL_MS) {
    doc.lastVersionAt = now;
    await insertVersion(doc.id, state, now, "", "");
  }
}

/** Saves a document's pending changes now, so what follows sees them on disk. */
export async function flushDoc(id: string) {
  const live = docs.get(id);
  if (!live) return;
  const doc = await live;
  if (!doc.saveTimer) return;
  clearTimeout(doc.saveTimer);
  doc.saveTimer = undefined;
  await saveDoc(doc);
}

export type VersionRow = { id: number; doc_id: string; created_at: number; name: string; author_id: string };

function insertVersion(docId: string, state: Buffer, at: number, name: string, authorId: string) {
  return get<VersionRow>(
    "INSERT INTO versions (doc_id, created_at, state_gzip, name, author_id) VALUES (?, ?, ?, ?, ?) RETURNING id, doc_id, created_at, name, author_id",
    [docId, at, zlib.gzipSync(state), name, authorId],
  );
}

/** Saves the current state of a document as a version right away. */
export async function saveVersionNow(docId: string, name: string, authorId: string): Promise<VersionRow> {
  const doc = await getDoc(docId);
  const now = Date.now();
  doc.lastVersionAt = now;
  const row = await insertVersion(docId, Buffer.from(Y.encodeStateAsUpdate(doc.ydoc)), now, name, authorId);
  return row!;
}

/** Removes a document, its saved versions and any copy held in memory. */
export async function deleteDoc(id: string) {
  const live = docs.get(id);
  lastUsed.delete(id);
  if (live) {
    docs.delete(id);
    const doc = await live;
    if (doc.saveTimer) clearTimeout(doc.saveTimer);
    doc.ydoc.destroy();
  }
  await run("DELETE FROM docs WHERE id = ?", [id]);
  await run("DELETE FROM versions WHERE doc_id = ?", [id]);
}
