import { rateLimit } from "./rateLimit";
import { OK } from "./ack";
import type { Ack } from "@commons-root/gen-shared";
import { Client } from "@rootsdk/server-app";
import {
  AccessLevel,
  GetVersionRequest,
  GetVersionResponse,
  ListVersionsRequest,
  ListVersionsResponse,
  RenameVersionRequest,
  SaveVersionRequest,
  SaveVersionResponse,
  Version,
} from "@commons-root/gen-shared";
import { HistoryServiceBase } from "@commons-root/gen-server";
import zlib from "zlib";
import { all, get, run } from "./db";
import { requireDoc } from "./docService";
import { saveVersionNow, VersionRow } from "./docStore";
import { CHUNK_BYTES, outgoingChunk, split, startOutgoing } from "./transfers";

const PAGE_SIZE = 50;
const NAME_MAX = 80;

const toVersion = (r: VersionRow): Version => ({
  id: BigInt(r.id),
  docId: r.doc_id,
  createdAt: BigInt(r.created_at),
  name: r.name,
  authorId: r.author_id,
});

async function findVersion(id: bigint): Promise<VersionRow & { state_gzip: Buffer }> {
  const row = await get<VersionRow & { state_gzip: Buffer }>("SELECT * FROM versions WHERE id = ?", [Number(id)]);
  if (!row) throw new Error("This version no longer exists.");
  return row;
}

export class HistoryService extends HistoryServiceBase {
  async listVersions(request: ListVersionsRequest, client: Client): Promise<ListVersionsResponse> {
    await requireDoc(request.docId, client.userId);
    const before = Number(request.beforeId) || Number.MAX_SAFE_INTEGER;
    const rows = await all<VersionRow>(
      "SELECT id, doc_id, created_at, name, author_id FROM versions WHERE doc_id = ? AND id < ? ORDER BY id DESC LIMIT ?",
      [request.docId, before, PAGE_SIZE + 1],
    );
    return { versions: rows.slice(0, PAGE_SIZE).map(toVersion), more: rows.length > PAGE_SIZE };
  }

  async saveVersion(request: SaveVersionRequest, client: Client): Promise<SaveVersionResponse> {
    rateLimit(client.userId, "saveVersion");
    await requireDoc(request.docId, client.userId, AccessLevel.EDIT);
    const row = await saveVersionNow(request.docId, request.name.trim().slice(0, NAME_MAX), client.userId);
    return { version: toVersion(row) };
  }

  async renameVersion(request: RenameVersionRequest, client: Client): Promise<Ack> {
    const version = await findVersion(request.id);
    await requireDoc(version.doc_id, client.userId, AccessLevel.EDIT);
    const name = request.name.trim().slice(0, NAME_MAX);
    // Naming an automatic version keeps it; the author is whoever named it.
    await run("UPDATE versions SET name = ?, author_id = CASE WHEN ? = '' THEN author_id ELSE ? END WHERE id = ?", [
      name,
      name,
      client.userId,
      version.id,
    ]);
    return OK;
  }

  async getVersion(request: GetVersionRequest, client: Client): Promise<GetVersionResponse> {
    if (request.transferId) {
      const part = outgoingChunk(request.transferId, request.chunk, `${client.userId}/version`);
      if (!part) throw new Error("Unknown or expired transfer");
      return { state: part.chunk, chunk: request.chunk, totalChunks: part.total, transferId: request.transferId };
    }
    const version = await findVersion(request.id);
    await requireDoc(version.doc_id, client.userId);
    const state = new Uint8Array(zlib.gunzipSync(version.state_gzip));
    if (state.length <= CHUNK_BYTES) return { state, chunk: 0, totalChunks: 1, transferId: "" };
    const chunks = split(state);
    return { state: chunks[0], chunk: 0, totalChunks: chunks.length, transferId: startOutgoing(chunks, `${client.userId}/version`) };
  }
}

export const historyService = new HistoryService();
