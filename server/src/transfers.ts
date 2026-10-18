import crypto from "crypto";

// A single Root message cannot exceed 256 KiB, so large Yjs payloads are
// split. Keep a margin for the protobuf envelope.
export const CHUNK_BYTES = 200 * 1024;
// At most 64 chunks (about 12.5 MiB) per transfer, so a client cannot make
// the server hold an arbitrary amount of memory.
export const MAX_CHUNKS = 64;
const TRANSFER_TTL_MS = 60 * 1000;

// owner: "<userId>/<docId>"; only that user can fetch or fill the transfer.
type Transfer = { owner: string; chunks: (Uint8Array | undefined)[]; expires: number };
const transfers = new Map<string, Transfer>();

function sweep() {
  const now = Date.now();
  for (const [id, t] of transfers) if (t.expires < now) transfers.delete(id);
}

export function split(data: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += CHUNK_BYTES) chunks.push(data.subarray(i, i + CHUNK_BYTES));
  return chunks.length ? chunks : [new Uint8Array()];
}

/** Stores outgoing chunks so their owner can fetch them one request at a time. */
export function startOutgoing(chunks: Uint8Array[], owner: string): string {
  sweep();
  const id = crypto.randomUUID();
  transfers.set(id, { owner, chunks, expires: Date.now() + TRANSFER_TTL_MS });
  return id;
}

export function outgoingChunk(id: string, index: number, owner: string): { chunk: Uint8Array; total: number } | undefined {
  const t = transfers.get(id);
  if (!t || t.owner !== owner) return undefined;
  const chunk = t.chunks[index];
  if (!chunk) return undefined;
  if (index === t.chunks.length - 1) transfers.delete(id);
  return { chunk, total: t.chunks.length };
}

/** Collects incoming chunks; returns the whole payload once every chunk arrived. */
export function receiveChunk(id: string, index: number, total: number, data: Uint8Array, owner: string): Uint8Array | undefined {
  sweep();
  if (!Number.isInteger(total) || total < 1 || total > MAX_CHUNKS) throw new Error("This change is too large to send.");
  if (!Number.isInteger(index) || index < 0 || index >= total || data.length > CHUNK_BYTES) throw new Error("Bad transfer chunk.");
  let t = transfers.get(id);
  if (!t) {
    t = { owner, chunks: new Array(total).fill(undefined), expires: Date.now() + TRANSFER_TTL_MS };
    transfers.set(id, t);
  }
  if (t.owner !== owner || t.chunks.length !== total) throw new Error("Bad transfer chunk.");
  t.chunks[index] = data;
  if (t.chunks.some((c) => c === undefined)) return undefined;
  transfers.delete(id);
  return Buffer.concat(t.chunks as Uint8Array[]);
}
