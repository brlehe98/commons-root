import { rateLimit } from "./rateLimit";
import { Client, DeviceContext, rootServer, ClientEvent, ClientContext, UserGuid } from "@rootsdk/server-app";
import {
  CommitPhotoRequest,
  CommitPhotoResponse,
  OpenRequest,
  OpenResponse,
  PushRequest,
  PushResponse,
} from "@commons-root/gen-shared";
import { DocServiceBase } from "@commons-root/gen-server";
import * as Y from "yjs";
import { onlySuggests } from "./suggestOnly";
import * as awarenessProtocol from "y-protocols/awareness";
import * as decoding from "lib0/decoding";
import fs from "fs";
import path from "path";
import { getDoc, liveDocs, LiveDoc } from "./docStore";
import { CHUNK_BYTES, outgoingChunk, receiveChunk, split, startOutgoing } from "./transfers";
import { all, get } from "./db";
import { AccessLevel } from "@commons-root/gen-shared";
import { AccessError, editsSomewhere, findSpace, isAppAdmin, levelIn, pageAccess, spaceAudience } from "./access";
import { commentProblem } from "./suggestOnly";
import type { PageRow } from "./pages";

/**
 * Doc ids are "page:<pageId>" (a page's draft), "template:<typeId>" (the text
 * a new page of the type starts from), "widget:<spaceId>_<widgetId>" (a text
 * block of a space's home page) and "dictionary:<spaceId>" (words the
 * space's writers added to the spell check). Anything else is refused, so no
 * one can open documents the app never made.
 */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const UUIDISH = /^[A-Za-z0-9-]{1,64}$/;

export type DocAccess = {
  /** The space the text belongs to; null for page type templates. */
  spaceId: string | null;
  /** Invisible (cannot open), Read, Comment (suggest only) or Edit. */
  level: AccessLevel;
};

export async function docAccess(docId: string, userId: UserGuid): Promise<DocAccess> {
  const parts = docId.split(":");
  const [kind, id] = parts;
  if (parts.length !== 2 || !id || !ID.test(id)) throw new Error("Unknown document.");
  if (kind === "page") {
    const page = await get<PageRow>("SELECT * FROM pages WHERE id = ?", [id]);
    if (!page) throw new Error("This page no longer exists.");
    const access = await pageAccess(userId, page);
    // Readers see the publication; the draft is for those who write in it.
    return { spaceId: page.space_id, level: access.level >= AccessLevel.COMMENT ? access.level : AccessLevel.INVISIBLE };
  }
  if (kind === "template") {
    if (!(await get<{ id: string }>("SELECT id FROM page_types WHERE id = ?", [id]))) throw new Error("This page type no longer exists.");
    return { spaceId: null, level: (await isAppAdmin(userId)) ? AccessLevel.EDIT : AccessLevel.INVISIBLE };
  }
  if (kind === "widget" || kind === "dictionary") {
    const spaceId = kind === "widget" ? id.split("_")[0] : id;
    if (!UUIDISH.test(spaceId)) throw new Error("Unknown document.");
    await findSpace(spaceId);
    const level = await levelIn(userId, spaceId);
    return { spaceId, level: level >= AccessLevel.EDIT ? AccessLevel.EDIT : level >= AccessLevel.READ ? AccessLevel.READ : AccessLevel.INVISIBLE };
  }
  throw new Error("Unknown document.");
}

/** Throws unless the member may open the text. */
export async function requireDoc(docId: string, userId: UserGuid, min: AccessLevel = AccessLevel.READ): Promise<DocAccess> {
  const access = await docAccess(docId, userId);
  if (access.level < Math.max(min, AccessLevel.READ)) throw new AccessError("You do not have access to this text.");
  return access;
}

/** Broadcast target for a text. */
export async function docAudience(access: DocAccess) {
  return access.spaceId ? spaceAudience(access.spaceId) : ("all" as const);
}

const EMPTY = new Uint8Array();
// A cursor and a name; anything bigger is not a real presence update.
const AWARENESS_MAX = 4 * 1024;

function deviceKey(client: DeviceContext & { userId: string }): string {
  return `${client.userId}/${client.deviceId ?? ""}`;
}

/** Reads the client ids carried by an awareness update. */
function awarenessClientIds(update: Uint8Array): number[] {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const ids: number[] = [];
  for (let i = 0; i < count; i++) {
    ids.push(decoding.readVarUint(decoder));
    decoding.readVarUint(decoder); // clock
    decoding.readVarString(decoder); // state JSON
  }
  return ids;
}

/** True when every cursor in the update names `userId` (or is a removal). */
function awarenessIsOwn(update: Uint8Array, userId: string): boolean {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  for (let i = 0; i < count; i++) {
    decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    let state: { user?: { id?: string } } | null;
    try {
      state = JSON.parse(decoding.readVarString(decoder));
    } catch {
      return false;
    }
    if (state?.user && state.user.id !== userId) return false;
  }
  return true;
}

export class DocService extends DocServiceBase {
  constructor() {
    super();
    // Remove the cursor of a device that leaves, since Root gives no other
    // presence signal.
    rootServer.clients.on(ClientEvent.UserDeviceDetached, (ctx: ClientContext) => {
      this.dropDevice(deviceKey(ctx)).catch((err) => console.error("dropDevice failed", err));
    });
  }

  async open(request: OpenRequest, client: Client): Promise<OpenResponse> {
    if (request.transferId) {
      const part = outgoingChunk(request.transferId, request.chunk, `${client.userId}/${request.docId}`);
      if (!part) throw new Error("Unknown or expired transfer");
      return {
        update: part.chunk,
        chunk: request.chunk,
        totalChunks: part.total,
        transferId: request.transferId,
        serverStateVector: EMPTY,
        awareness: EMPTY,
      };
    }

    await requireDoc(request.docId, client.userId);
    const doc = await getDoc(request.docId);
    const update = Y.encodeStateAsUpdate(doc.ydoc, request.stateVector.length ? request.stateVector : undefined);
    const states = Array.from(doc.awareness.getStates().keys());
    const awareness = states.length ? awarenessProtocol.encodeAwarenessUpdate(doc.awareness, states) : EMPTY;
    const response: OpenResponse = {
      update,
      chunk: 0,
      totalChunks: 1,
      transferId: "",
      serverStateVector: Y.encodeStateVector(doc.ydoc),
      awareness,
    };
    if (update.length > CHUNK_BYTES) {
      const chunks = split(update);
      response.transferId = startOutgoing(chunks, `${client.userId}/${request.docId}`);
      response.update = chunks[0];
      response.totalChunks = chunks.length;
    }
    return response;
  }

  async push(request: PushRequest, client: Client): Promise<PushResponse> {
    const access = await requireDoc(request.docId, client.userId);
    // Comment level may only suggest: checked below, once the update is whole.
    const level = access.level;
    if (level < AccessLevel.COMMENT && request.update.length) throw new Error("You can only read this text.");
    let update = request.update;
    if (request.totalChunks > 1) {
      const whole = receiveChunk(request.transferId, request.chunk, request.totalChunks, request.update, `${client.userId}/${request.docId}`);
      if (!whole) return { ok: true };
      update = whole;
    }

    const doc = await getDoc(request.docId);
    if (level === AccessLevel.COMMENT && update.length && !onlySuggests(doc.ydoc, update)) {
      throw new Error("Your access level lets you suggest changes, not edit the text. Switch to Suggesting and try again.");
    }
    if (update.length) {
      // Comments are written under the writer's own name, at any level.
      const problem = commentProblem(doc.ydoc, update, client.userId, level >= AccessLevel.EDIT);
      if (problem) throw new Error(problem);
      Y.applyUpdate(doc.ydoc, update, client);
    }
    if (request.awareness.length) {
      if (request.awareness.length > AWARENESS_MAX || !awarenessIsOwn(request.awareness, client.userId))
        throw new Error("Bad cursor update.");
      this.applyAwareness(doc, request.awareness, client);
    }

    const tooBig = update.length + request.awareness.length > CHUNK_BYTES;
    this.broadcastUpdate(
      {
        docId: request.docId,
        update: tooBig ? EMPTY : update,
        awareness: tooBig ? EMPTY : request.awareness,
        resync: tooBig,
      },
      await docAudience(access),
      client,
    );
    return { ok: true };
  }

  async commitPhoto(request: CommitPhotoRequest, client: Client): Promise<CommitPhotoResponse> {
    rateLimit(client.userId, "commitPhoto");
    // Tokens come from Root's file picker: short, without path separators or spaces.
    if (typeof request.token !== "string" || !UPLOAD_TOKEN.test(request.token)) throw new Error("Invalid upload.");
    // Files go into texts, so only people who can write somewhere may store one.
    if (!(await editsSomewhere(client.userId)) && !(await suggestsSomewhere(client.userId))) throw new Error("You cannot add files.");
    if (devHostCutUpload(request.token)) {
      throw new Error("This photo is over 10 MB: Root's dev host cut it in half. Export a smaller copy and add it again.");
    }
    const result = await rootServer.dataStore.assets.create({ tokens: [request.token] });
    const uri = result.assets[request.token];
    if (!uri) throw new Error("Photo upload failed");
    return { uri };
  }

  private applyAwareness(doc: LiveDoc, update: Uint8Array, client: Client) {
    const key = deviceKey(client);
    let ids = doc.awarenessByDevice.get(key);
    if (!ids) doc.awarenessByDevice.set(key, (ids = new Set()));
    for (const id of awarenessClientIds(update)) ids.add(id);
    awarenessProtocol.applyAwarenessUpdate(doc.awareness, update, client);
  }

  private async dropDevice(key: string) {
    for (const doc of await liveDocs()) {
      const ids = doc.awarenessByDevice.get(key);
      if (!ids) continue;
      doc.awarenessByDevice.delete(key);
      const gone = Array.from(ids).filter((id) => doc.awareness.getStates().has(id));
      if (!gone.length) continue;
      // Encoding removed ids yields null states, which clients read as a removal.
      awarenessProtocol.removeAwarenessStates(doc.awareness, gone, "server");
      const update = awarenessProtocol.encodeAwarenessUpdate(doc.awareness, gone);
      let audience: Awaited<ReturnType<typeof docAudience>> = [];
      try {
        const [kind, id] = doc.id.split(":");
        const spaceId = kind === "page" ? (await get<PageRow>("SELECT space_id FROM pages WHERE id = ?", [id]))?.space_id : kind === "template" ? null : id.split("_")[0];
        audience = spaceId === undefined ? [] : await docAudience({ spaceId, level: AccessLevel.READ });
      } catch {
        continue;
      }
      this.broadcastUpdate({ docId: doc.id, update: EMPTY, awareness: update, resync: false }, audience);
    }
  }
}

export const docService = new DocService();

// Root's dev host keeps a copy of each upload in .tempUploads and silently
// cuts files at 10 MiB (its busboy limit), so the stored photo is half grey.
// Outside the dev host the copy does not exist and this is always false.
const DEV_HOST_UPLOAD_LIMIT = 10 * 1024 * 1024;
const UPLOAD_TOKEN = /^[A-Za-z0-9:/._+=-]{1,512}$/;

function devHostCutUpload(token: string): boolean {
  try {
    // Only a plain file name inside .tempUploads, never a path out of it.
    const name = path.basename(token.split("/").pop() ?? "");
    if (!name || name === "." || name === ".." || name.includes("\\")) return false;
    const file = path.join(process.cwd(), ".tempUploads", name);
    return fs.statSync(file).size >= DEV_HOST_UPLOAD_LIMIT;
  } catch {
    return false;
  }
}

/** True when some page the member can read is open to community suggestions or edits. */
async function suggestsSomewhere(userId: UserGuid): Promise<boolean> {
  const spaces = await all<{ space_id: string }>("SELECT DISTINCT space_id FROM pages WHERE community > 0", []);
  for (const s of spaces) if ((await levelIn(userId, s.space_id)) >= AccessLevel.READ) return true;
  return false;
}
