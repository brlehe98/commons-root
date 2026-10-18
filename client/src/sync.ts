import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { docServiceClient, DocServiceClientEvent } from "@commons-root/gen-client";
import { DocEvent, OpenResponse } from "@commons-root/gen-shared";

// Root allows 10 requests per second per client. Edits and cursor moves are
// merged and sent at most this often, one request at a time.
const SEND_INTERVAL_MS = 200;
// Same margin as the server under the 256 KiB message limit.
const CHUNK_BYTES = 200 * 1024;
// Catches any broadcast missed while Root was reconnecting.
const RESYNC_INTERVAL_MS = 30 * 1000;

const REMOTE = "remote";
const EMPTY = new Uint8Array();

export type SyncStatus = "connecting" | "synced" | "error";


// Matches the server error for a direct edit by someone at Comment level.
const REFUSED = /suggest changes, not edit/;
/** Relays a Yjs document through the app server and Root broadcasts. */
export class DocSync {
  readonly ydoc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.ydoc);
  status: SyncStatus = "connecting";
  onStatus?: (status: SyncStatus) => void;
  /**
   * The server refused the local edits for good (Comment level may only
   * suggest). They are dropped; the owner should reopen the text from the server.
   */
  onRefused?: (message: string) => void;

  private pendingUpdates: Uint8Array[] = [];
  private pendingAwareness = new Set<number>();
  private sending = false;
  private timer?: number;
  private resyncTimer?: number;
  private closed = false;

  constructor(readonly docId: string) {
    this.ydoc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE) return;
      this.pendingUpdates.push(update);
      this.schedule();
    });
    this.awareness.on("update", ({ added, updated, removed }: AwarenessChanges, origin: unknown) => {
      if (origin === REMOTE) return;
      for (const id of [...added, ...updated, ...removed]) this.pendingAwareness.add(id);
      this.schedule();
    });
    docServiceClient.on(DocServiceClientEvent.Update, this.onBroadcast);
    window.addEventListener("pagehide", this.flushNow);
  }

  /** True once the server copy arrived at least once. */
  loaded = false;

  /**
   * Shows a saved copy before the server answers. It counts as coming from
   * the server: nothing in it is sent back unless the server lacks it.
   */
  seed(update: Uint8Array) {
    Y.applyUpdate(this.ydoc, update, REMOTE);
  }

  /** The whole text, for the saved copy. */
  state(): Uint8Array {
    return Y.encodeStateAsUpdate(this.ydoc);
  }

  async start() {
    await this.resync();
    this.resyncTimer = window.setInterval(() => this.resync().catch(() => undefined), RESYNC_INTERVAL_MS);
  }

  destroy() {
    this.closed = true;
    window.clearInterval(this.resyncTimer);
    window.clearTimeout(this.timer);
    window.removeEventListener("pagehide", this.flushNow);
    docServiceClient.off(DocServiceClientEvent.Update, this.onBroadcast);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.ydoc.clientID], "destroy");
    this.flushNow();
    this.awareness.destroy();
    this.ydoc.destroy();
  }

  /** Two-way catch-up: fetch what the server has, then push what it lacks. */
  async resync() {
    try {
      const first = await docServiceClient.open({
        docId: this.docId,
        stateVector: Y.encodeStateVector(this.ydoc),
        transferId: "",
        chunk: 0,
      });
      const update = await this.collectChunks(first);
      if (update.length) Y.applyUpdate(this.ydoc, update, REMOTE);
      if (first.awareness.length) awarenessProtocol.applyAwarenessUpdate(this.awareness, first.awareness, REMOTE);

      const missing = Y.encodeStateAsUpdate(this.ydoc, first.serverStateVector);
      // An update with no structs and no deletions encodes to 2 bytes.
      if (missing.length > 2) this.pendingUpdates.push(missing);
      this.pendingAwareness.add(this.ydoc.clientID);
      this.schedule();
      this.loaded = true;
      this.setStatus("synced");
    } catch (err) {
      console.error("resync failed", err);
      this.setStatus("error");
      throw err;
    }
  }

  private async collectChunks(first: OpenResponse): Promise<Uint8Array> {
    if (first.totalChunks <= 1) return first.update;
    const parts = [first.update];
    for (let i = 1; i < first.totalChunks; i++) {
      const next = await docServiceClient.open({ docId: this.docId, stateVector: EMPTY, transferId: first.transferId, chunk: i });
      parts.push(next.update);
    }
    return concat(parts);
  }

  private onBroadcast = (event: DocEvent) => {
    if (event.docId !== this.docId) return;
    if (event.resync) {
      this.resync().catch(() => undefined);
      return;
    }
    if (event.update.length) Y.applyUpdate(this.ydoc, event.update, REMOTE);
    if (event.awareness.length) awarenessProtocol.applyAwarenessUpdate(this.awareness, event.awareness, REMOTE);
  };

  private schedule() {
    if (this.timer !== undefined || this.sending || this.closed) return;
    this.timer = window.setTimeout(() => {
      this.timer = undefined;
      this.send();
    }, SEND_INTERVAL_MS);
  }

  private flushNow = () => {
    window.clearTimeout(this.timer);
    this.timer = undefined;
    this.send();
  };

  private async send() {
    if (this.sending) return;
    if (!this.pendingUpdates.length && !this.pendingAwareness.size) return;
    this.sending = true;
    const updates = this.pendingUpdates;
    const awarenessIds = Array.from(this.pendingAwareness);
    this.pendingUpdates = [];
    this.pendingAwareness.clear();
    try {
      const update = updates.length ? Y.mergeUpdates(updates) : EMPTY;
      const awareness = awarenessIds.length ? awarenessProtocol.encodeAwarenessUpdate(this.awareness, awarenessIds) : EMPTY;
      if (update.length + awareness.length <= CHUNK_BYTES) {
        await docServiceClient.push({ docId: this.docId, update, awareness, transferId: "", chunk: 0, totalChunks: 1 });
      } else {
        const chunks = split(update);
        const transferId = crypto.randomUUID();
        for (let i = 0; i < chunks.length; i++) {
          await docServiceClient.push({
            docId: this.docId,
            update: chunks[i],
            awareness: i === chunks.length - 1 ? awareness : EMPTY,
            transferId,
            chunk: i,
            totalChunks: chunks.length,
          });
          await sleep(SEND_INTERVAL_MS);
        }
      }
      this.setStatus("synced");
    } catch (err) {
      console.error("push failed", err);
      const message = String((err as Error)?.message ?? err);
      if (REFUSED.test(message)) {
        // Retrying would refuse every later change merged with these.
        this.onRefused?.(message);
        return;
      }
      // Keep the edits and try again on the next round.
      this.pendingUpdates.unshift(...updates);
      awarenessIds.forEach((id) => this.pendingAwareness.add(id));
      this.setStatus("error");
      await sleep(2000);
    } finally {
      this.sending = false;
      if (this.pendingUpdates.length || this.pendingAwareness.size) this.schedule();
    }
  }

  private setStatus(status: SyncStatus) {
    if (this.status === status) return;
    this.status = status;
    this.onStatus?.(status);
  }
}

type AwarenessChanges = { added: number[]; updated: number[]; removed: number[] };

function split(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += CHUNK_BYTES) chunks.push(data.subarray(i, i + CHUNK_BYTES));
  return chunks;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
