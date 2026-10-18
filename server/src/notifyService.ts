import { rateLimit } from "./rateLimit";
import { OK } from "./ack";
import { Client, rootServer, UserGuid } from "@rootsdk/server-app";
import {
  AccessLevel,
  Ack,
  GetPrefsResponse,
  ListMembersResponse,
  MentionableRequest,
  NotifyKind,
  ReportActivityRequest,
  ReportKind,
  SetPrefsRequest,
} from "@commons-root/gen-shared";
import { NotifyServiceBase } from "@commons-root/gen-server";
import * as Y from "yjs";
import { all, get, marks, run } from "./db";
import { adminRoleIds, canSeePage, currentSettings, pageAccess } from "./access";
import { docAccess, requireDoc } from "./docService";
import { getDoc, LiveDoc } from "./docStore";
import { findPage, PageRow, wikiEvents } from "./pages";

// Root's limits for a notification.
const TITLE_MAX = 50;
const TEXT_MAX = 150;
// Events on the same page for the same person within this window become
// one notification.
const BURST_MS = 30 * 1000;
const MEMBER_CACHE_MS = 5 * 60 * 1000;
const MAX_REPORTED = 20;
// How much of a page title a notification line shows.
const NAME_IN_LINE = 32;

/** Everyone the user mentioned in their comments of this document. */
function mentionsBy(doc: LiveDoc, userId: string): Set<string> {
  const out = new Set<string>();
  doc.ydoc.getMap("comments").forEach((thread) => {
    const list = thread instanceof Y.Map ? thread.get("messages") : null;
    if (!(list instanceof Y.Array)) return;
    for (const m of list.toArray() as { authorId?: string; mentions?: string[] }[])
      if (m?.authorId === userId) for (const id of m.mentions ?? []) out.add(id);
  });
  return out;
}

type Pending = { pageId: string; lines: string[]; timer: NodeJS.Timeout };
const pending = new Map<string, Pending>();

let memberCache: { at: number; members: { userId: string; nickname: string; roles: string[] }[] } | null = null;

async function members() {
  if (memberCache && Date.now() - memberCache.at < MEMBER_CACHE_MS) return memberCache.members;
  const list = await rootServer.community.communityMembers.listAll();
  memberCache = {
    at: Date.now(),
    members: list.map((m) => ({ userId: m.userId, nickname: m.nickname, roles: m.communityRoleIds as string[] })),
  };
  return memberCache.members;
}

async function nameOf(userId: string): Promise<string> {
  return (await members()).find((m) => m.userId === userId)?.nickname ?? "Someone";
}

async function enabled(userId: string, kind: NotifyKind): Promise<boolean> {
  const row = await get<{ enabled: number }>("SELECT enabled FROM notify_prefs WHERE user_id = ? AND kind = ?", [userId, kind]);
  return row ? !!row.enabled : true;
}

function clip(text: string, max: number) {
  return text.length <= max ? text : text.slice(0, max - 1) + "…";
}

const titleOf = (page: PageRow) => (page.published_title || page.title || "Untitled page").trim();
/** The page as a notification line names it: “Getting started…”. */
const named = (page: PageRow) => `“${clip(titleOf(page), NAME_IN_LINE)}”`;

/**
 * Queues a notification. The person who acted is never told, nor anyone
 * who cannot see the page (or its draft, for `draft` events) or turned this
 * kind off. Lines never quote the text: notifications can show on a locked screen.
 */
async function notify(page: PageRow, userIds: string[], actorId: string, kind: NotifyKind, line: string, draft = false) {
  for (const userId of new Set(userIds)) {
    if (!userId || userId === actorId) continue;
    const access = await pageAccess(userId as UserGuid, page);
    if (draft ? access.level < AccessLevel.COMMENT : !canSeePage(access, page)) continue;
    if (!(await enabled(userId, kind))) continue;
    const key = `${userId}/${page.id}`;
    const entry = pending.get(key);
    if (entry) {
      if (!entry.lines.includes(line)) entry.lines.push(line);
      continue;
    }
    pending.set(key, {
      pageId: page.id,
      lines: [line],
      timer: setTimeout(() => flush(key, userId).catch((err) => console.error("notify failed", err)), BURST_MS),
    });
  }
}

async function flush(key: string, userId: string) {
  const entry = pending.get(key);
  if (!entry) return;
  pending.delete(key);
  const page = await get<PageRow>("SELECT * FROM pages WHERE id = ?", [entry.pageId]);
  if (!page) return;
  const description = entry.lines.length === 1 ? entry.lines[0] : `${entry.lines.length} updates. ${entry.lines.slice(-2).join(" ")}`;
  await rootServer.community.notifications.send({
    userIds: [userId as UserGuid],
    title: clip(titleOf(page), TITLE_MAX),
    description: clip(description, TEXT_MAX),
    relativeUrl: `/?page=${encodeURIComponent(page.id)}`,
  });
}

/**
 * The members who edit the space through a role or as named app admins.
 * While no admin is named everyone is admin, and nobody is singled out.
 */
async function editorsOf(spaceId: string): Promise<string[]> {
  const rows = await all<{ role_id: string }>("SELECT role_id FROM space_access WHERE space_id = ? AND level >= ?", [spaceId, AccessLevel.EDIT]);
  const roles = new Set([...rows.map((r) => r.role_id), ...adminRoleIds()]);
  const adminUsers = new Set((currentSettings()?.access?.appAdmins as { userIds?: string[] } | undefined)?.userIds ?? []);
  return (await members()).filter((m) => adminUsers.has(m.userId) || m.roles.some((r) => roles.has(r))).map((m) => m.userId);
}

/** Who follows the page, its category or a category above it. */
async function followersOf(page: PageRow): Promise<string[]> {
  const categories: string[] = [];
  for (let at = page.category_id; at && categories.length < 50; ) {
    categories.push(at);
    at = (await get<{ parent_id: string }>("SELECT parent_id FROM categories WHERE id = ?", [at]))?.parent_id ?? "";
  }
  const rows = await all<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM follows WHERE (kind = 'page' AND target_id = ?)${
      categories.length ? ` OR (kind = 'category' AND target_id IN (${marks(categories.length)}))` : ""
    }`,
    [page.id, ...categories],
  );
  return rows.map((r) => r.user_id);
}

export async function initNotify() {
  wikiEvents.on("published", ({ page, userId }) => {
    (async () => {
      const line = `${await nameOf(userId)} published a new version of ${named(page)}.`;
      await notify(page, await followersOf(page), userId, NotifyKind.PAGE_UPDATED, line);
    })().catch((err) => console.error("published notify failed", err));
  });
  wikiEvents.on("reported", ({ page, userId, kind }) => {
    (async () => {
      const who = await nameOf(userId);
      const line = kind === ReportKind.REPORT_ADDITION ? `${who} suggested an addition to ${named(page)}.` : `${who} reported an error in ${named(page)}.`;
      await notify(page, await editorsOf(page.space_id), userId, NotifyKind.REPORT, line);
    })().catch((err) => console.error("reported notify failed", err));
  });
}

export class NotifyService extends NotifyServiceBase {
  async reportActivity(request: ReportActivityRequest, client: Client): Promise<void> {
    rateLimit(client.userId, "reportActivity");
    await requireDoc(request.docId, client.userId, AccessLevel.COMMENT);
    const [kind, id] = request.docId.split(":");
    // Only page drafts notify; templates and home texts are the admins' own.
    if (kind !== "page") return;
    const page = await findPage(id);
    // A short list, and for mentions only people the writer really mentioned.
    if (request.userIds.length > MAX_REPORTED) throw new Error("Too many people to notify.");
    if (request.kind === NotifyKind.MENTION) {
      const mentioned = mentionsBy(await getDoc(request.docId), client.userId);
      request.userIds = request.userIds.filter((u) => mentioned.has(u));
    }
    const who = await nameOf(client.userId);
    const where = named(page);
    switch (request.kind) {
      case NotifyKind.MENTION:
        await notify(page, request.userIds, client.userId, NotifyKind.MENTION, `${who} mentioned you in a comment on ${where}.`, true);
        break;
      case NotifyKind.COMMENT:
        await notify(page, [page.created_by, ...request.userIds], client.userId, NotifyKind.COMMENT, `${who} commented on ${where}.`, true);
        break;
      case NotifyKind.SUGGESTION_ADDED:
        await notify(page, await editorsOf(page.space_id), client.userId, NotifyKind.SUGGESTION_ADDED, `${who} suggested changes to ${where}.`, true);
        break;
      case NotifyKind.SUGGESTION_RESOLVED:
        await notify(
          page,
          request.userIds,
          client.userId,
          NotifyKind.SUGGESTION_RESOLVED,
          `${who} ${request.accepted ? "accepted" : "rejected"} your suggestion on ${where}.`,
          true,
        );
        break;
      default:
        throw new Error("This activity cannot be reported.");
    }
  }

  async getPrefs(client: Client): Promise<GetPrefsResponse> {
    const rows = await all<{ kind: number; enabled: number }>("SELECT kind, enabled FROM notify_prefs WHERE user_id = ?", [client.userId]);
    const kinds = Object.values(NotifyKind).filter((k): k is NotifyKind => typeof k === "number");
    return { prefs: kinds.map((kind) => ({ kind, enabled: rows.find((r) => r.kind === kind)?.enabled !== 0 })) };
  }

  async setPrefs(request: SetPrefsRequest, client: Client): Promise<Ack> {
    const known = new Set(Object.values(NotifyKind).filter((k) => typeof k === "number"));
    for (const p of request.prefs.filter((p) => known.has(p.kind)))
      await run(
        "INSERT INTO notify_prefs (user_id, kind, enabled) VALUES (?, ?, ?) ON CONFLICT(user_id, kind) DO UPDATE SET enabled = excluded.enabled",
        [client.userId, p.kind, p.enabled ? 1 : 0],
      );
    return OK;
  }

  async listMentionable(request: MentionableRequest, client: Client): Promise<ListMembersResponse> {
    await requireDoc(request.docId, client.userId, AccessLevel.COMMENT);
    const result = [];
    for (const m of await members())
      if ((await docAccess(request.docId, m.userId as UserGuid)).level >= AccessLevel.COMMENT) result.push({ userId: m.userId, nickname: m.nickname });
    result.sort((a, b) => a.nickname.localeCompare(b.nickname));
    return { members: result };
  }
}

export const notifyService = new NotifyService();
