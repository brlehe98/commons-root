import { rateLimit } from "./rateLimit";
import { OK } from "./ack";
import { Client, CommunityRoleGuid, GlobalSettingsEvent, rootServer, UserGuid } from "@rootsdk/server-app";
import {
  AccessLevel,
  Ack,
  Category,
  CheckLinksRequest,
  CheckLinksResponse,
  Community,
  CreatePageRequest,
  CreatePageResponse,
  FieldDef,
  FieldKind,
  FieldValue,
  FindPagesRequest,
  FollowRequest,
  FollowingRequest,
  FollowingResponse,
  GetAccessRequest,
  GetAccessResponse,
  GetContentRequest,
  GetContentResponse,
  GetHomeRequest,
  GetHomeResponse,
  GetMeResponse,
  GetPageResponse,
  IdRequest,
  ListCategoriesRequest,
  ListCategoriesResponse,
  ListPagesRequest,
  ListPagesResponse,
  ListPageTypesResponse,
  ListReportsRequest,
  ListReportsResponse,
  ListRevisionsResponse,
  ListRolesResponse,
  NameColorsRequest,
  NameColorsResponse,
  ListSpacesResponse,
  ListTagsRequest,
  ListTagsResponse,
  MoveCategoryRequest,
  MovePageRequest,
  PageType,
  PublishRequest,
  ReorderRequest,
  ReportKind,
  ResolveReportRequest,
  SaveCategoryRequest,
  SaveCategoryResponse,
  SaveHomeRequest,
  TranslateHomeRequest,
  SavePageTypeResponse,
  SaveSpaceRequest,
  SaveSpaceResponse,
  SearchRequest,
  SearchResponse,
  SendReportRequest,
  SetAccessRequest,
  SetCommunityRequest,
  SetStyleRequest,
  Space,
  UpdatePageRequest,
  Widget,
  WidgetKind,
} from "@commons-root/gen-shared";
import { WikiServiceBase } from "@commons-root/gen-server";
import crypto from "crypto";
import zlib from "zlib";
import { all, exec, get, hasFts, marks, run } from "./db";
import { cleanColor, cleanIcon } from "./style";
import {
  AccessError,
  adminRoleIds,
  adminsUnset,
  canSeePage,
  deleteSpaceGroup,
  findSpace,
  isAppAdmin,
  serverAdminRoleIds,
  levelIn,
  pageAccess,
  requireAdmin,
  requireLevel,
  spaceAudience,
  SpaceRow,
  syncSpaceGroup,
  rolesOf,
} from "./access";
import { deleteDoc, flushDoc, getDoc } from "./docStore";
import { docToJson, jsonText, leadOf, linkedPages } from "./content";
import {
  cleanTags,
  cleanValues,
  copyTemplate,
  copyText,
  findPage,
  findType,
  LANGS,
  pageDoc,
  PageRow,
  PageTypeRow,
  parseJson,
  writeParagraphs,
  setTags,
  summaries,
  tagsOf,
  templateDoc,
  TITLE_MAX,
  toPage,
  toPageType,
  toSummary,
  visible,
  wikiEvents,
  writeTemplate,
} from "./pages";
import { CHUNK_BYTES, outgoingChunk, split, startOutgoing } from "./transfers";

const NAME_MAX = 80;
const NOTE_MAX = 200;
const REPORT_MAX = 2000;
const WIDGETS_MAX = 20;
const LIST_MAX = 200;
const FIELDS_MAX = 30;
const OPTIONS_MAX = 40;
const SEARCH_MAX = 50;

const toSpace = (r: SpaceRow, level: AccessLevel): Space => ({
  id: r.id,
  name: r.name,
  position: r.position,
  level,
  icon: r.icon,
  color: r.color,
  main: !!r.main,
  roleId: r.role_id,
  everyoneReads: !!(r.main || r.everyone_reads),
});

type CategoryRow = { id: string; space_id: string; parent_id: string; name: string; position: number; icon: string; color: string };
const toCategory = (r: CategoryRow, pageCount: number): Category => ({
  id: r.id,
  spaceId: r.space_id,
  parentId: r.parent_id,
  name: r.name,
  position: r.position,
  pageCount,
  icon: r.icon,
  color: r.color,
});

// Role colors change rarely: listed once a minute at most.
let rolesCache: { roles: { id: string; colorHex: string }[]; expires: number } | null = null;
async function communityRoles() {
  if (rolesCache && rolesCache.expires > Date.now()) return rolesCache.roles;
  const roles = await rootServer.community.communityRoles.list();
  rolesCache = { roles, expires: Date.now() + 60_000 };
  return roles;
}

// The page types a new community starts with; admins rename, change or delete them.
const BASE_TYPES: { name: string; icon: string; fields: Omit<FieldDef, "id" | "icon">[]; sections: string[] }[] = [
  {
    name: "Guide",
    icon: "BookOpen",
    fields: [
      { name: "Goal", kind: FieldKind.FIELD_TEXT, options: [] },
      { name: "Who it's for", kind: FieldKind.FIELD_TEXT, options: [] },
    ],
    sections: ["Before you start", "Steps", "Tips"],
  },
  {
    name: "Tool",
    icon: "Wrench",
    fields: [
      { name: "Link", kind: FieldKind.FIELD_LINK, options: [] },
      { name: "Platform", kind: FieldKind.FIELD_TEXT, options: [] },
    ],
    sections: ["What it does", "How to use it", "Alternatives"],
  },
  {
    name: "Reference",
    icon: "Library",
    fields: [
      { name: "Authors", kind: FieldKind.FIELD_TEXT, options: [] },
      { name: "Year", kind: FieldKind.FIELD_NUMBER, options: [] },
    ],
    sections: ["Summary", "Criticism", "History"],
  },
  {
    name: "Resource",
    icon: "FileText",
    fields: [
      { name: "Format", kind: FieldKind.FIELD_CHOICE, options: ["Article", "Book", "Video", "Podcast", "Website", "Other"] },
      { name: "Link", kind: FieldKind.FIELD_LINK, options: [] },
      { name: "Language", kind: FieldKind.FIELD_TEXT, options: [] },
    ],
    sections: ["About", "Why it is useful"],
  },
  { name: "Page", icon: "File", fields: [], sections: [] },
];

const DEFAULT_HOME = (): Widget[] => [
  { id: crypto.randomUUID(), kind: WidgetKind.WIDGET_TEXT, title: "", pageIds: [], count: 0, categoryId: "", tag: "", links: [], wide: true, pages: [] },
  { id: crypto.randomUUID(), kind: WidgetKind.WIDGET_SEARCH, title: "", pageIds: [], count: 0, categoryId: "", tag: "", links: [], wide: true, pages: [] },
  { id: crypto.randomUUID(), kind: WidgetKind.WIDGET_FEATURED, title: "", pageIds: [], count: 0, categoryId: "", tag: "", links: [], wide: false, pages: [] },
  { id: crypto.randomUUID(), kind: WidgetKind.WIDGET_RECENT, title: "", pageIds: [], count: 8, categoryId: "", tag: "", links: [], wide: false, pages: [] },
];

const widgetDoc = (spaceId: string, widgetId: string) => `widget:${spaceId}_${widgetId}`;
const homeTranslations = (space: SpaceRow) => parseJson<Record<string, Widget[]>>(space.home_i18n, {});
const allHomeWidgets = (space: SpaceRow) => [...parseJson<Widget[]>(space.home, []), ...Object.values(homeTranslations(space)).flat()];

// Shown until the editors write their own; they edit it from the home page.
const WELCOME = [
  "Welcome to the knowledge base: guides, tools, references and resources shared by the community.",
  "Browse the categories on the left, search, or open a featured page.",
];

export async function initWiki() {
  if (!(await get("SELECT 1 FROM spaces WHERE main = 1", []))) {
    await run("INSERT INTO spaces (id, name, position, main, everyone_reads, home) VALUES (?, ?, 0, 1, 1, ?)", [
      crypto.randomUUID(),
      "Knowledge base",
      JSON.stringify(DEFAULT_HOME()),
    ]);
  }
  // The main space's first text block opens with a welcome, once.
  const main = await get<{ id: string; home: string }>("SELECT id, home FROM spaces WHERE main = 1", []);
  const welcome = main && parseJson<Widget[]>(main.home, []).find((w) => w.kind === WidgetKind.WIDGET_TEXT);
  if (main && welcome) {
    const docId = `widget:${main.id}_${welcome.id}`;
    if (!(await get("SELECT 1 FROM docs WHERE id = ?", [docId]))) {
      await writeParagraphs(docId, WELCOME);
      await flushDoc(docId);
    }
  }
  if (!(await get("SELECT 1 FROM page_types", []))) {
    for (let i = 0; i < BASE_TYPES.length; i++) {
      const t = BASE_TYPES[i];
      const id = crypto.randomUUID();
      const fields: FieldDef[] = t.fields.map((f) => ({ ...f, id: crypto.randomUUID(), icon: "" }));
      await run("INSERT INTO page_types (id, name, icon, fields, position) VALUES (?, ?, ?, ?, ?)", [id, t.name, t.icon, JSON.stringify(fields), i]);
      if (t.sections.length) await writeTemplate(id, t.sections);
    }
  }
}

function cleanName(value: string, what: string): string {
  const name = value.replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
  if (!name) throw new Error(`${what} needs a name.`);
  return name;
}

function cleanLink(url: string): string {
  const value = url.trim().slice(0, 500);
  if (/^#\/page\/[A-Za-z0-9_-]{1,64}$/.test(value)) return value;
  try {
    const parsed = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

/** Words for a full-text query: each one as a prefix, accents ignored. */
function ftsQuery(query: string): string {
  return query
    .replace(/["*()^:]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 12)
    .map((w) => `"${w}"*`)
    .join(" ");
}

const SNIPPET_OPEN = "\u0002";
const SNIPPET_CLOSE = "\u0003";

/** The words around the first match, in plain search. */
function likeSnippet(body: string, query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = body.toLowerCase();
  const at = Math.max(0, Math.min(...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0), body.length));
  const start = Math.max(0, at - 60);
  return (start ? "…" : "") + body.slice(start, start + 180).replace(/\s+/g, " ") + "…";
}

export class WikiService extends WikiServiceBase {
  constructor() {
    super();
    // App admins see every space, so a change of admins changes every audience.
    rootServer.globalSettings?.on(GlobalSettingsEvent.Update, () => {
      this.resyncAllGroups().catch((err) => console.error("resyncAllGroups failed", err));
    });
  }

  async resyncAllGroups() {
    const rows = await all<{ id: string }>("SELECT id FROM spaces", []);
    for (const r of rows) await syncSpaceGroup(r.id);
    this.broadcastSpacesChanged({}, "all");
  }

  // ---------- Me and spaces ----------

  async getMe(client: Client): Promise<GetMeResponse> {
    const spaces = await all<SpaceRow>("SELECT * FROM spaces", []);
    const editing: string[] = [];
    for (const s of spaces) if ((await levelIn(client.userId, s.id, s)) >= AccessLevel.EDIT) editing.push(s.id);
    const open = editing.length
      ? await get<{ n: number }>(`SELECT COUNT(*) AS n FROM reports WHERE resolved_at IS NULL AND space_id IN (${marks(editing.length)})`, editing)
      : undefined;
    return { userId: client.userId, isAdmin: await isAppAdmin(client.userId), adminsUnset: adminsUnset(), openReports: open?.n ?? 0 };
  }

  async listSpaces(client: Client): Promise<ListSpacesResponse> {
    const rows = await all<SpaceRow>("SELECT * FROM spaces ORDER BY main DESC, position", []);
    const spaces: Space[] = [];
    for (const r of rows) {
      const level = await levelIn(client.userId, r.id, r);
      if (level > AccessLevel.INVISIBLE) spaces.push(toSpace(r, level));
    }
    return { spaces };
  }

  async saveSpace(request: SaveSpaceRequest, client: Client): Promise<SaveSpaceResponse> {
    await requireAdmin(client.userId);
    const name = cleanName(request.name, "A space");
    let id = request.id;
    if (id) {
      const space = await findSpace(id);
      await run("UPDATE spaces SET name = ?, everyone_reads = ? WHERE id = ?", [name, space.main || request.everyoneReads ? 1 : 0, id]);
    } else {
      id = crypto.randomUUID();
      const max = await get<{ p: number | null }>("SELECT MAX(position) AS p FROM spaces", []);
      await run("INSERT INTO spaces (id, name, position, main, role_id, everyone_reads, home) VALUES (?, ?, ?, 0, '', ?, ?)", [
        id,
        name,
        (max?.p ?? 0) + 1,
        request.everyoneReads ? 1 : 0,
        JSON.stringify(DEFAULT_HOME()),
      ]);
    }
    await syncSpaceGroup(id);
    this.broadcastSpacesChanged({}, "all");
    return { space: toSpace(await findSpace(id), AccessLevel.ADMIN) };
  }

  async deleteSpace(request: IdRequest, client: Client): Promise<Ack> {
    await requireAdmin(client.userId);
    const space = await findSpace(request.id);
    if (space.main) throw new Error("The main space cannot be deleted.");
    const count = await get<{ n: number }>("SELECT COUNT(*) AS n FROM pages WHERE space_id = ?", [space.id]);
    if (count?.n) throw new Error("Move or delete the pages in this space first.");
    for (const w of allHomeWidgets(space)) if (w.kind === WidgetKind.WIDGET_TEXT) await deleteDoc(widgetDoc(space.id, w.id));
    await deleteDoc(`dictionary:${space.id}`);
    await run("DELETE FROM space_access WHERE space_id = ?", [space.id]);
    const cats = await all<{ id: string }>("SELECT id FROM categories WHERE space_id = ?", [space.id]);
    for (const c of cats) await run("DELETE FROM follows WHERE kind = 'category' AND target_id = ?", [c.id]);
    await run("DELETE FROM categories WHERE space_id = ?", [space.id]);
    await run("DELETE FROM spaces WHERE id = ?", [space.id]);
    await deleteSpaceGroup(space.id);
    this.broadcastSpacesChanged({}, "all");
    return OK;
  }

  async reorderSpaces(request: ReorderRequest, client: Client): Promise<Ack> {
    await requireAdmin(client.userId);
    for (let i = 0; i < request.ids.length; i++) await run("UPDATE spaces SET position = ? WHERE id = ?", [i + 1, request.ids[i]]);
    this.broadcastSpacesChanged({}, "all");
    return OK;
  }

  async setSpaceStyle(request: SetStyleRequest, client: Client): Promise<Ack> {
    await requireAdmin(client.userId);
    await run("UPDATE spaces SET icon = ?, color = ? WHERE id = ?", [cleanIcon(request.icon), cleanColor(request.color), request.id]);
    this.broadcastSpacesChanged({}, "all");
    return OK;
  }

  async getAccess(request: GetAccessRequest, client: Client): Promise<GetAccessResponse> {
    await requireAdmin(client.userId);
    const roles = await rootServer.community.communityRoles.list();
    const rows = await all<{ role_id: string; level: number }>("SELECT * FROM space_access WHERE space_id = ?", [request.spaceId]);
    const levels = new Map(rows.map((r) => [r.role_id, r.level]));
    const admins = new Set([...adminRoleIds(), ...(await serverAdminRoleIds())]);
    return {
      roles: roles.map((r) => ({
        roleId: r.id,
        roleName: r.name,
        roleColor: r.colorHex,
        level: admins.has(r.id) ? AccessLevel.ADMIN : (levels.get(r.id) ?? AccessLevel.INVISIBLE),
        appAdmin: admins.has(r.id),
      })),
    };
  }

  async setAccess(request: SetAccessRequest, client: Client): Promise<Ack> {
    await requireAdmin(client.userId);
    await findSpace(request.spaceId);
    await run("DELETE FROM space_access WHERE space_id = ?", [request.spaceId]);
    const admins = new Set([...adminRoleIds(), ...(await serverAdminRoleIds())]);
    for (const r of request.roles) {
      // App admin roles are Admin everywhere through the app settings.
      if (r.level > AccessLevel.INVISIBLE && r.level <= AccessLevel.ADMIN && !admins.has(r.roleId)) {
        await run("INSERT INTO space_access (space_id, role_id, level) VALUES (?, ?, ?)", [request.spaceId, r.roleId as CommunityRoleGuid, r.level]);
      }
    }
    await syncSpaceGroup(request.spaceId);
    this.broadcastSpacesChanged({}, "all");
    return OK;
  }

  /** Each member's name color: their first role (in Root's order) that has a color. */
  async nameColors(request: NameColorsRequest, client: Client): Promise<NameColorsResponse> {
    rateLimit(client.userId, "nameColors");
    const roles = (await communityRoles()).filter((r) => /^#[0-9a-fA-F]{3,8}$/.test(r.colorHex ?? ""));
    const ids = Array.from(new Set(request.userIds.filter((id) => /^[A-Za-z0-9_-]{1,64}$/.test(id)))).slice(0, 50);
    const colors = [];
    for (const userId of ids) {
      const mine = new Set(await rolesOf(userId as UserGuid));
      const role = roles.find((r) => mine.has(r.id));
      if (role) colors.push({ userId, color: role.colorHex });
    }
    return { colors };
  }

  async listRoles(client: Client): Promise<ListRolesResponse> {
    await requireAdmin(client.userId);
    const roles = await rootServer.community.communityRoles.list();
    return { roles: roles.map((r) => ({ id: r.id, name: r.name, color: r.colorHex })) };
  }

  // ---------- Categories ----------

  async listCategories(request: ListCategoriesRequest, client: Client): Promise<ListCategoriesResponse> {
    await requireLevel(client.userId, request.spaceId, AccessLevel.READ);
    const rows = await all<CategoryRow & { n: number }>(
      `SELECT c.*, (SELECT COUNT(*) FROM pages p WHERE p.category_id = c.id AND p.revision_id IS NOT NULL) AS n
       FROM categories c WHERE c.space_id = ? ORDER BY c.position`,
      [request.spaceId],
    );
    return {
      categories: rows.map((r) => toCategory(r, r.n)),
    };
  }

  async saveCategory(request: SaveCategoryRequest, client: Client): Promise<SaveCategoryResponse> {
    const name = cleanName(request.name, "A category");
    let row: CategoryRow | undefined;
    if (request.id) {
      row = await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [request.id]);
      if (!row) throw new Error("This category no longer exists.");
      await requireLevel(client.userId, row.space_id, AccessLevel.EDIT);
      await run("UPDATE categories SET name = ?, icon = ?, color = ? WHERE id = ?", [name, cleanIcon(request.icon), cleanColor(request.color), row.id]);
    } else {
      await requireLevel(client.userId, request.spaceId, AccessLevel.EDIT);
      await findSpace(request.spaceId);
      const parent = request.parentId ? await this.category(request.parentId, request.spaceId) : undefined;
      const max = await get<{ p: number | null }>("SELECT MAX(position) AS p FROM categories WHERE space_id = ? AND parent_id = ?", [
        request.spaceId,
        parent?.id ?? "",
      ]);
      const id = crypto.randomUUID();
      await run("INSERT INTO categories (id, space_id, parent_id, name, position, icon, color) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        id,
        request.spaceId,
        parent?.id ?? "",
        name,
        (max?.p ?? -1) + 1,
        cleanIcon(request.icon),
        cleanColor(request.color),
      ]);
      row = await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [id]);
    }
    const saved = (await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [row!.id]))!;
    this.spaceChanged(saved.space_id);
    return { category: toCategory(saved, 0) };
  }

  async moveCategory(request: MoveCategoryRequest, client: Client): Promise<Ack> {
    const row = await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [request.id]);
    if (!row) throw new Error("This category no longer exists.");
    await requireLevel(client.userId, row.space_id, AccessLevel.EDIT);
    const parentId = request.parentId || "";
    if (parentId) {
      await this.category(parentId, row.space_id);
      // Never under itself or one of its own subcategories.
      for (let at: string = parentId; at; ) {
        if (at === row.id) throw new Error("A category cannot go inside itself.");
        at = (await get<CategoryRow>("SELECT parent_id FROM categories WHERE id = ?", [at]))?.parent_id ?? "";
      }
    }
    const siblings = (
      await all<CategoryRow>("SELECT * FROM categories WHERE space_id = ? AND parent_id = ? AND id != ? ORDER BY position", [row.space_id, parentId, row.id])
    ).map((c) => c.id);
    const at = request.beforeId ? siblings.indexOf(request.beforeId) : -1;
    siblings.splice(at >= 0 ? at : siblings.length, 0, row.id);
    await run("UPDATE categories SET parent_id = ? WHERE id = ?", [parentId, row.id]);
    for (let i = 0; i < siblings.length; i++) await run("UPDATE categories SET position = ? WHERE id = ?", [i, siblings[i]]);
    this.spaceChanged(row.space_id);
    return OK;
  }

  /** Its pages and subcategories move up to its parent. */
  async deleteCategory(request: IdRequest, client: Client): Promise<Ack> {
    const row = await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [request.id]);
    if (!row) return OK;
    await requireLevel(client.userId, row.space_id, AccessLevel.EDIT);
    await run("UPDATE pages SET category_id = ? WHERE category_id = ?", [row.parent_id, row.id]);
    await run("UPDATE categories SET parent_id = ? WHERE parent_id = ?", [row.parent_id, row.id]);
    await run("DELETE FROM follows WHERE kind = 'category' AND target_id = ?", [row.id]);
    await run("DELETE FROM categories WHERE id = ?", [row.id]);
    this.spaceChanged(row.space_id);
    return OK;
  }

  private async category(id: string, spaceId: string): Promise<CategoryRow> {
    const row = await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [id]);
    if (!row || row.space_id !== spaceId) throw new Error("This category is not in this space.");
    return row;
  }

  // ---------- Page types ----------

  async listPageTypes(client: Client): Promise<ListPageTypesResponse> {
    // Every member sees the types: they name pages and their infobox.
    if ((await levelIn(client.userId, (await this.mainSpace()).id)) < AccessLevel.READ) throw new AccessError("You do not have access.");
    const rows = await all<PageTypeRow>("SELECT * FROM page_types ORDER BY position", []);
    return { types: rows.map(toPageType) };
  }

  async savePageType(request: PageType, client: Client): Promise<SavePageTypeResponse> {
    await requireAdmin(client.userId);
    const name = cleanName(request.name, "A page type");
    const fields: FieldDef[] = request.fields.slice(0, FIELDS_MAX).map((f) => ({
      id: /^[A-Za-z0-9-]{1,64}$/.test(f.id) ? f.id : crypto.randomUUID(),
      name: cleanName(f.name, "A field"),
      icon: cleanIcon(f.icon),
      kind: Object.values(FieldKind).includes(f.kind) ? f.kind : FieldKind.FIELD_TEXT,
      options:
        f.kind === FieldKind.FIELD_CHOICE
          ? Array.from(new Set(f.options.map((o) => o.trim().slice(0, NAME_MAX)).filter(Boolean))).slice(0, OPTIONS_MAX)
          : [],
    }));
    let id = request.id;
    if (id && (await get("SELECT 1 FROM page_types WHERE id = ?", [id]))) {
      await run("UPDATE page_types SET name = ?, icon = ?, fields = ? WHERE id = ?", [name, cleanIcon(request.icon), JSON.stringify(fields), id]);
    } else {
      id = crypto.randomUUID();
      const max = await get<{ p: number | null }>("SELECT MAX(position) AS p FROM page_types", []);
      await run("INSERT INTO page_types (id, name, icon, fields, position) VALUES (?, ?, ?, ?, ?)", [
        id,
        name,
        cleanIcon(request.icon),
        JSON.stringify(fields),
        (max?.p ?? -1) + 1,
      ]);
    }
    this.broadcastSpacesChanged({}, "all");
    return { type: toPageType((await get<PageTypeRow>("SELECT * FROM page_types WHERE id = ?", [id]))!) };
  }

  /** Pages of the type keep their text; their infobox goes. */
  async deletePageType(request: IdRequest, client: Client): Promise<Ack> {
    await requireAdmin(client.userId);
    await run("UPDATE pages SET type_id = '' WHERE type_id = ?", [request.id]);
    await run("DELETE FROM page_types WHERE id = ?", [request.id]);
    await deleteDoc(templateDoc(request.id));
    this.broadcastSpacesChanged({}, "all");
    return OK;
  }

  async reorderPageTypes(request: ReorderRequest, client: Client): Promise<Ack> {
    await requireAdmin(client.userId);
    for (let i = 0; i < request.ids.length; i++) await run("UPDATE page_types SET position = ? WHERE id = ?", [i, request.ids[i]]);
    this.broadcastSpacesChanged({}, "all");
    return OK;
  }

  private async mainSpace(): Promise<SpaceRow> {
    const row = await get<SpaceRow>("SELECT * FROM spaces WHERE main = 1", []);
    if (!row) throw new Error("The main space is missing.");
    return row;
  }

  // ---------- Pages ----------

  async listPages(request: ListPagesRequest, client: Client): Promise<ListPagesResponse> {
    const level = await requireLevel(client.userId, request.spaceId, AccessLevel.READ);
    const where = ["p.space_id = ?"];
    const params: unknown[] = [request.spaceId];
    if (request.categoryId) {
      const ids = request.deep ? await this.categoryTree(request.categoryId) : [request.categoryId];
      where.push(`p.category_id IN (${marks(ids.length)})`);
      params.push(...ids);
    }
    if (request.tag) {
      where.push("EXISTS (SELECT 1 FROM page_tags t WHERE t.page_id = p.id AND t.tag = ?)");
      params.push(cleanTags([request.tag])[0] ?? "");
    }
    if (request.typeId) {
      where.push("p.type_id = ?");
      params.push(request.typeId);
    }
    if (request.drafts) {
      if (level < AccessLevel.COMMENT && !(await get("SELECT 1 FROM pages WHERE space_id = ? AND community > 0", [request.spaceId])))
        return { pages: [] };
      where.push("(p.revision_id IS NULL OR p.draft_changed = 1)");
    } else where.push("p.revision_id IS NOT NULL");
    const order = request.recent ? "COALESCE(p.published_at, p.updated_at) DESC" : "COALESCE(NULLIF(p.published_title, ''), p.title) COLLATE NOCASE";
    const limit = Math.min(Math.max(request.limit || LIST_MAX, 1), LIST_MAX);
    const rows = await all<PageRow>(`SELECT p.* FROM pages p WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ?`, [...params, limit]);
    let shown = await visible(client.userId, rows);
    // Drafts: only those the member writes in.
    if (request.drafts) shown = shown.filter((s) => s.access.level >= AccessLevel.COMMENT);
    const tags = await tagsOf(shown.map((s) => s.row.id));
    return {
      pages: shown.map((s) => {
        const summary = toSummary(s.row, tags.get(s.row.id) ?? []);
        // In the drafts list, the title being written.
        if (request.drafts) summary.title = s.row.title;
        return summary;
      }),
    };
  }

  private async categoryTree(id: string): Promise<string[]> {
    const out = [id];
    for (let i = 0; i < out.length && out.length < 500; i++) {
      const children = await all<{ id: string }>("SELECT id FROM categories WHERE parent_id = ?", [out[i]]);
      out.push(...children.map((c) => c.id));
    }
    return out;
  }

  async getPage(request: IdRequest, client: Client): Promise<GetPageResponse> {
    const row = await findPage(request.id);
    const access = await pageAccess(client.userId, row);
    if (!canSeePage(access, row)) throw new AccessError("You do not have access to this page.");
    return { page: await toPage(row, client.userId, access) };
  }

  async createPage(request: CreatePageRequest, client: Client): Promise<CreatePageResponse> {
    rateLimit(client.userId, "createPage");
    let spaceId = request.spaceId;
    let group = "";
    let typeId = request.typeId;
    let categoryId = request.categoryId;
    if (request.translationOf) {
      const original = await findPage(request.translationOf);
      spaceId = original.space_id;
      group = original.translation_group;
      typeId = original.type_id;
      categoryId = original.category_id;
      if (!LANGS.has(request.lang)) throw new Error("Choose the language of the translation.");
      if (await get("SELECT 1 FROM pages WHERE translation_group = ? AND lang = ?", [group, request.lang]))
        throw new Error("This page already has a translation in this language.");
    }
    await requireLevel(client.userId, spaceId, AccessLevel.EDIT);
    await findSpace(spaceId);
    if (typeId && !(await findType(typeId))) typeId = "";
    if (categoryId) await this.category(categoryId, spaceId);
    const id = crypto.randomUUID();
    const now = Date.now();
    const title = request.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || "Untitled page";
    await run(
      `INSERT INTO pages (id, space_id, title, type_id, category_id, lang, translation_group, created_at, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, spaceId, title, typeId, categoryId, LANGS.has(request.lang) ? request.lang : "", group || id, now, client.userId, now],
    );
    await copyTemplate(typeId, id);
    this.spaceChanged(spaceId);
    const row = await findPage(id);
    return { page: await toPage(row, client.userId, await pageAccess(client.userId, row)) };
  }

  async updatePage(request: UpdatePageRequest, client: Client): Promise<Ack> {
    const row = await findPage(request.id);
    const access = await pageAccess(client.userId, row);
    if (access.level < AccessLevel.EDIT) throw new AccessError("You cannot edit this page.");
    const title = request.title.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX) || row.title;
    let typeId = row.type_id;
    let categoryId = row.category_id;
    let lang = row.lang;
    // How the page is filed is for the space's editors.
    if (access.canPublish) {
      typeId = request.typeId && (await findType(request.typeId)) ? request.typeId : "";
      categoryId = request.categoryId ? (await this.category(request.categoryId, row.space_id)).id : "";
      lang = LANGS.has(request.lang) ? request.lang : "";
      if (lang && lang !== row.lang && (await get("SELECT 1 FROM pages WHERE translation_group = ? AND lang = ? AND id != ?", [row.translation_group, lang, row.id])))
        throw new Error("Another translation of this page is already in this language.");
    }
    const fields = cleanValues(request.fields, await findType(typeId));
    await run("UPDATE pages SET title = ?, type_id = ?, category_id = ?, lang = ?, fields = ?, updated_at = ?, draft_changed = 1 WHERE id = ?", [
      title,
      typeId,
      categoryId,
      lang,
      JSON.stringify(fields),
      Date.now(),
      row.id,
    ]);
    // Tags and the category file the page at once, published or not.
    await setTags(row.id, request.tags);
    if (row.revision_id != null) await this.indexPage(row.id);
    await this.pageChanged(row.id, row.space_id);
    return OK;
  }

  async setCommunity(request: SetCommunityRequest, client: Client): Promise<Ack> {
    const row = await findPage(request.id);
    if (!(await pageAccess(client.userId, row)).canPublish) throw new AccessError("Only the space's editors can change this.");
    const value = [Community.NONE, Community.SUGGEST, Community.EDIT].includes(request.community) ? request.community : Community.NONE;
    await run("UPDATE pages SET community = ? WHERE id = ?", [value, row.id]);
    await this.pageChanged(row.id, row.space_id);
    return OK;
  }

  async movePage(request: MovePageRequest, client: Client): Promise<Ack> {
    const row = await findPage(request.id);
    if (!(await pageAccess(client.userId, row)).canPublish) throw new AccessError("Only the space's editors can move this page.");
    await requireLevel(client.userId, request.spaceId, AccessLevel.EDIT);
    await findSpace(request.spaceId);
    const categoryId = request.categoryId ? (await this.category(request.categoryId, request.spaceId)).id : "";
    // A page moves with its translations, so they stay in one space.
    const group = await all<{ id: string }>("SELECT id FROM pages WHERE translation_group = ?", [row.translation_group]);
    for (const p of group) {
      await run("UPDATE pages SET space_id = ?, category_id = ? WHERE id = ?", [request.spaceId, categoryId, p.id]);
      await run("UPDATE reports SET space_id = ? WHERE page_id = ?", [request.spaceId, p.id]);
    }
    this.spaceChanged(row.space_id);
    await this.pageChanged(row.id, request.spaceId);
    return OK;
  }

  async deletePage(request: IdRequest, client: Client): Promise<Ack> {
    const row = await findPage(request.id);
    if (!(await pageAccess(client.userId, row)).canPublish) throw new AccessError("Only the space's editors can delete this page.");
    await deleteDoc(pageDoc(row.id));
    for (const table of ["page_tags", "revisions", "page_text", "reports"]) await run(`DELETE FROM ${table} WHERE page_id = ?`, [row.id]);
    await run("DELETE FROM page_links WHERE from_id = ?", [row.id]);
    await run("DELETE FROM follows WHERE kind = 'page' AND target_id = ?", [row.id]);
    if (hasFts) await run("DELETE FROM page_fts WHERE page_id = ?", [row.id]);
    await run("DELETE FROM pages WHERE id = ?", [row.id]);
    // Its translations stay; the next one leads the group.
    const next = await get<{ id: string }>("SELECT id FROM pages WHERE translation_group = ? ORDER BY created_at LIMIT 1", [row.translation_group]);
    if (next && row.translation_group === row.id) await run("UPDATE pages SET translation_group = ? WHERE translation_group = ?", [next.id, row.id]);
    // Featured on a home page: taken off.
    const unfeature = (widgets: Widget[]) => widgets.map((w) => ({ ...w, pageIds: (w.pageIds ?? []).filter((p) => p !== row.id) }));
    for (const s of await all<SpaceRow>("SELECT * FROM spaces WHERE home LIKE ? OR home_i18n LIKE ?", [`%${row.id}%`, `%${row.id}%`])) {
      const translations = Object.fromEntries(Object.entries(homeTranslations(s)).map(([lang, widgets]) => [lang, unfeature(widgets)]));
      await run("UPDATE spaces SET home = ?, home_i18n = ? WHERE id = ?", [JSON.stringify(unfeature(parseJson<Widget[]>(s.home, []))), JSON.stringify(translations), s.id]);
    }
    this.spaceChanged(row.space_id);
    this.broadcastPageChanged({ pageId: row.id, spaceId: row.space_id }, await spaceAudience(row.space_id));
    return OK;
  }

  async publish(request: PublishRequest, client: Client): Promise<Ack> {
    rateLimit(client.userId, "publish");
    const row = await findPage(request.id);
    if (!(await pageAccess(client.userId, row)).canPublish) throw new AccessError("Only the space's editors can publish.");
    const docId = pageDoc(row.id);
    await flushDoc(docId);
    const json = docToJson((await getDoc(docId)).ydoc);
    const content = zlib.gzipSync(Buffer.from(JSON.stringify(json)));
    const now = Date.now();
    const note = request.note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX);
    const revision = await get<{ id: number }>(
      "INSERT INTO revisions (page_id, created_at, author_id, note, title, fields, content_gzip) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id",
      [row.id, now, client.userId, note, row.title, row.fields, content],
    );
    await run(
      `UPDATE pages SET revision_id = ?, published_at = ?, published_by = ?, published_title = ?, published_fields = ?, lead = ?, draft_changed = 0 WHERE id = ?`,
      [revision!.id, now, client.userId, row.title, row.fields, leadOf(json), row.id],
    );
    await run("DELETE FROM page_links WHERE from_id = ?", [row.id]);
    for (const to of linkedPages(json)) if (to !== row.id) await run("INSERT OR IGNORE INTO page_links (from_id, to_id) VALUES (?, ?)", [row.id, to]);
    await run("INSERT OR REPLACE INTO page_text (page_id, title, body) VALUES (?, ?, ?)", [row.id, row.title, jsonText(json)]);
    await this.indexPage(row.id);
    wikiEvents.emit("published", { page: await findPage(row.id), userId: client.userId, note });
    this.spaceChanged(row.space_id);
    await this.pageChanged(row.id, row.space_id);
    return OK;
  }

  /** Refreshes the full-text entry of a published page (title, text, tags). */
  private async indexPage(pageId: string) {
    if (!hasFts) return;
    const text = await get<{ title: string; body: string }>("SELECT title, body FROM page_text WHERE page_id = ?", [pageId]);
    if (!text) return;
    const page = await findPage(pageId);
    const tags = (await tagsOf([pageId])).get(pageId) ?? [];
    await run("DELETE FROM page_fts WHERE page_id = ?", [pageId]);
    await run("INSERT INTO page_fts (page_id, title, body, tags) VALUES (?, ?, ?, ?)", [pageId, page.published_title || text.title, text.body, tags.join(" ")]);
  }

  async listRevisions(request: IdRequest, client: Client): Promise<ListRevisionsResponse> {
    const row = await findPage(request.id);
    if (!canSeePage(await pageAccess(client.userId, row), row)) throw new AccessError("You do not have access to this page.");
    const rows = await all<{ id: number; created_at: number; author_id: string; note: string; title: string }>(
      "SELECT id, created_at, author_id, note, title FROM revisions WHERE page_id = ? ORDER BY id DESC LIMIT 200",
      [row.id],
    );
    return {
      revisions: rows.map((r) => ({ id: BigInt(r.id), createdAt: BigInt(r.created_at), authorId: r.author_id, note: r.note, title: r.title })),
    };
  }

  async getContent(request: GetContentRequest, client: Client): Promise<GetContentResponse> {
    const owner = `${client.userId}/content`;
    if (request.transferId) {
      const part = outgoingChunk(request.transferId, request.chunk, owner);
      if (!part) throw new Error("Unknown or expired transfer");
      return { json: part.chunk, chunk: request.chunk, totalChunks: part.total, transferId: request.transferId, title: "", fields: [] };
    }
    const row = await findPage(request.pageId);
    if (!canSeePage(await pageAccess(client.userId, row), row)) throw new AccessError("You do not have access to this page.");
    const revisionId = Number(request.revisionId) || row.revision_id;
    if (revisionId == null) throw new Error("This page is not published yet.");
    const rev = await get<{ content_gzip: Buffer; title: string; fields: string }>(
      "SELECT content_gzip, title, fields FROM revisions WHERE id = ? AND page_id = ?",
      [revisionId, row.id],
    );
    if (!rev) throw new Error("This version no longer exists.");
    const json = new Uint8Array(zlib.gunzipSync(rev.content_gzip));
    const fields = parseJson<FieldValue[]>(rev.fields, []);
    if (json.length <= CHUNK_BYTES) return { json, chunk: 0, totalChunks: 1, transferId: "", title: rev.title, fields };
    const chunks = split(json);
    return { json: chunks[0], chunk: 0, totalChunks: chunks.length, transferId: startOutgoing(chunks, owner), title: rev.title, fields };
  }

  async search(request: SearchRequest, client: Client): Promise<SearchResponse> {
    rateLimit(client.userId, "search");
    const query = request.query.trim().slice(0, 200);
    const where: string[] = ["p.revision_id IS NOT NULL"];
    const params: unknown[] = [];
    if (request.spaceId) {
      await requireLevel(client.userId, request.spaceId, AccessLevel.READ);
      where.push("p.space_id = ?");
      params.push(request.spaceId);
    }
    if (request.categoryId) {
      const ids = await this.categoryTree(request.categoryId);
      where.push(`p.category_id IN (${marks(ids.length)})`);
      params.push(...ids);
    }
    if (request.tag) {
      where.push("EXISTS (SELECT 1 FROM page_tags t WHERE t.page_id = p.id AND t.tag = ?)");
      params.push(cleanTags([request.tag])[0] ?? "");
    }
    if (request.typeId) {
      where.push("p.type_id = ?");
      params.push(request.typeId);
    }
    let rows: (PageRow & { snip?: string; body?: string })[];
    const match = ftsQuery(query);
    if (!query) {
      rows = await all(`SELECT p.* FROM pages p WHERE ${where.join(" AND ")} ORDER BY p.published_at DESC LIMIT ?`, [...params, SEARCH_MAX * 3]);
    } else if (hasFts && match) {
      rows = await all(
        `SELECT p.*, snippet(page_fts, 2, '${SNIPPET_OPEN}', '${SNIPPET_CLOSE}', '…', 16) AS snip
         FROM page_fts f JOIN pages p ON p.id = f.page_id
         WHERE page_fts MATCH ? AND ${where.join(" AND ")} ORDER BY bm25(page_fts, 0, 8.0, 1.0, 4.0) LIMIT ?`,
        [match, ...params, SEARCH_MAX * 3],
      );
    } else {
      const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
      rows = await all(
        `SELECT p.*, t.body AS body FROM pages p JOIN page_text t ON t.page_id = p.id
         WHERE (p.published_title LIKE ? ESCAPE '\\' OR t.body LIKE ? ESCAPE '\\') AND ${where.join(" AND ")}
         ORDER BY CASE WHEN p.published_title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, p.published_at DESC LIMIT ?`,
        [like, like, ...params, like, SEARCH_MAX * 3],
      );
    }
    const shown = (await visible(client.userId, rows)).slice(0, SEARCH_MAX);
    const tags = await tagsOf(shown.map((s) => s.row.id));
    return {
      pages: shown.map(({ row }) => {
        const r = row as PageRow & { snip?: string; body?: string };
        return { ...toSummary(r, tags.get(r.id) ?? []), snippet: r.snip ?? (r.body && query ? likeSnippet(r.body, query) : "") };
      }),
    };
  }

  async findPages(request: FindPagesRequest, client: Client): Promise<SearchResponse> {
    const query = request.query.trim().slice(0, 100);
    const like = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = await all<PageRow>(
      `SELECT * FROM pages WHERE (title LIKE ? ESCAPE '\\' OR published_title LIKE ? ESCAPE '\\')
       ORDER BY CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END, title COLLATE NOCASE LIMIT 60`,
      [like, like, `${query.replace(/[%_\\]/g, "\\$&")}%`],
    );
    return { pages: (await summaries(client.userId, rows)).slice(0, 20) };
  }

  async listTags(request: ListTagsRequest, client: Client): Promise<ListTagsResponse> {
    await requireLevel(client.userId, request.spaceId, AccessLevel.READ);
    const rows = await all<{ tag: string; n: number }>(
      `SELECT t.tag, COUNT(*) AS n FROM page_tags t JOIN pages p ON p.id = t.page_id
       WHERE p.space_id = ? AND p.revision_id IS NOT NULL GROUP BY t.tag ORDER BY n DESC, t.tag LIMIT 300`,
      [request.spaceId],
    );
    return { tags: rows.map((r) => ({ tag: r.tag, count: r.n })) };
  }

  async checkLinks(request: CheckLinksRequest, client: Client): Promise<CheckLinksResponse> {
    const ids = Array.from(new Set(request.pageIds)).slice(0, 300);
    if (!ids.length) return { pages: [] };
    const rows = await all<PageRow>(`SELECT * FROM pages WHERE id IN (${marks(ids.length)})`, ids);
    return { pages: await summaries(client.userId, rows) };
  }

  // ---------- Home ----------

  async getHome(request: GetHomeRequest, client: Client): Promise<GetHomeResponse> {
    await requireLevel(client.userId, request.spaceId, AccessLevel.READ);
    const space = await findSpace(request.spaceId);
    const translations = homeTranslations(space);
    const lang = LANGS.has(request.lang) && translations[request.lang] ? request.lang : "";
    const widgets = lang ? translations[lang] : parseJson<Widget[]>(space.home, []);
    for (const w of widgets) {
      w.pages = [];
      if (w.kind === WidgetKind.WIDGET_FEATURED && w.pageIds?.length) {
        const rows = await all<PageRow>(`SELECT * FROM pages WHERE id IN (${marks(w.pageIds.length)}) AND revision_id IS NOT NULL`, w.pageIds);
        const found = await summaries(client.userId, rows);
        w.pages = w.pageIds.map((id) => found.find((p) => p.id === id)).filter((p): p is NonNullable<typeof p> => !!p);
      } else if (w.kind === WidgetKind.WIDGET_RECENT || w.kind === WidgetKind.WIDGET_LIST) {
        const { pages } = await this.listPages(
          {
            spaceId: space.id,
            categoryId: w.kind === WidgetKind.WIDGET_LIST ? w.categoryId : "",
            deep: true,
            tag: w.kind === WidgetKind.WIDGET_LIST ? w.tag : "",
            typeId: "",
            drafts: false,
            recent: w.kind === WidgetKind.WIDGET_RECENT,
            limit: Math.min(Math.max(w.count || 8, 1), 30),
          },
          client,
        );
        w.pages = pages;
      }
    }
    return { widgets, lang, langs: Object.keys(translations).sort() };
  }

  async saveHome(request: SaveHomeRequest, client: Client): Promise<Ack> {
    await requireLevel(client.userId, request.spaceId, AccessLevel.EDIT);
    const space = await findSpace(request.spaceId);
    const kinds = new Set(Object.values(WidgetKind));
    const widgets: Widget[] = request.widgets.slice(0, WIDGETS_MAX).map((w) => ({
      id: /^[A-Za-z0-9-]{1,64}$/.test(w.id) ? w.id : crypto.randomUUID(),
      kind: kinds.has(w.kind) ? w.kind : WidgetKind.WIDGET_TEXT,
      title: w.title.replace(/\s+/g, " ").trim().slice(0, NAME_MAX),
      pageIds: w.pageIds.filter((id) => /^[A-Za-z0-9-]{1,64}$/.test(id)).slice(0, 30),
      count: Math.min(Math.max(Math.round(w.count) || 8, 1), 30),
      categoryId: /^[A-Za-z0-9-]{0,64}$/.test(w.categoryId) ? w.categoryId : "",
      tag: cleanTags([w.tag])[0] ?? "",
      links: w.links
        .slice(0, 30)
        .map((l) => ({ label: l.label.trim().slice(0, NAME_MAX), url: cleanLink(l.url) }))
        .filter((l) => l.url),
      wide: !!w.wide,
      pages: [],
    }));
    const translations = homeTranslations(space);
    if (request.lang && !(LANGS.has(request.lang) && translations[request.lang])) throw new Error("This translation no longer exists.");
    const before = request.lang ? translations[request.lang] : parseJson<Widget[]>(space.home, []);
    // Text blocks taken off the page take their text with them.
    const kept = new Set(widgets.map((w) => w.id));
    for (const w of before) if (w.kind === WidgetKind.WIDGET_TEXT && !kept.has(w.id)) await deleteDoc(widgetDoc(space.id, w.id));
    if (request.lang) {
      translations[request.lang] = widgets;
      await run("UPDATE spaces SET home_i18n = ? WHERE id = ?", [JSON.stringify(translations), space.id]);
    } else {
      await run("UPDATE spaces SET home = ? WHERE id = ?", [JSON.stringify(widgets), space.id]);
    }
    this.spaceChanged(space.id);
    return OK;
  }

  async translateHome(request: TranslateHomeRequest, client: Client): Promise<Ack> {
    await requireLevel(client.userId, request.spaceId, AccessLevel.EDIT);
    if (!LANGS.has(request.lang)) throw new Error("Choose the language of the translation.");
    const space = await findSpace(request.spaceId);
    const translations = homeTranslations(space);
    if (request.remove) {
      for (const w of translations[request.lang] ?? []) if (w.kind === WidgetKind.WIDGET_TEXT) await deleteDoc(widgetDoc(space.id, w.id));
      delete translations[request.lang];
    } else {
      if (translations[request.lang]) return OK;
      // A copy of the original to translate, each text block with its own copy of the text.
      const copy: Widget[] = [];
      for (const w of parseJson<Widget[]>(space.home, [])) {
        const id = crypto.randomUUID();
        if (w.kind === WidgetKind.WIDGET_TEXT) await copyText(widgetDoc(space.id, w.id), widgetDoc(space.id, id));
        copy.push({ ...w, id, pages: [] });
      }
      translations[request.lang] = copy;
    }
    await run("UPDATE spaces SET home_i18n = ? WHERE id = ?", [JSON.stringify(translations), space.id]);
    this.spaceChanged(space.id);
    return OK;
  }

  // ---------- Reports and following ----------

  async sendReport(request: SendReportRequest, client: Client): Promise<Ack> {
    rateLimit(client.userId, "sendReport");
    const row = await findPage(request.pageId);
    const access = await pageAccess(client.userId, row);
    if (!canSeePage(access, row)) throw new AccessError("You do not have access to this page.");
    const text = request.text.trim().slice(0, REPORT_MAX);
    if (!text) throw new Error("Say what is wrong or what to add.");
    const kind = request.kind === ReportKind.REPORT_ADDITION ? ReportKind.REPORT_ADDITION : ReportKind.REPORT_ERROR;
    await run("INSERT INTO reports (id, page_id, space_id, kind, text, author_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      crypto.randomUUID(),
      row.id,
      row.space_id,
      kind,
      text,
      client.userId,
      Date.now(),
    ]);
    wikiEvents.emit("reported", { page: row, userId: client.userId, kind });
    await this.pageChanged(row.id, row.space_id);
    return OK;
  }

  async listReports(request: ListReportsRequest, client: Client): Promise<ListReportsResponse> {
    let spaceIds: string[];
    if (request.pageId) {
      const page = await findPage(request.pageId);
      await requireLevel(client.userId, page.space_id, AccessLevel.EDIT);
      spaceIds = [page.space_id];
    } else if (request.spaceId) {
      await requireLevel(client.userId, request.spaceId, AccessLevel.EDIT);
      spaceIds = [request.spaceId];
    } else {
      spaceIds = [];
      for (const s of await all<SpaceRow>("SELECT * FROM spaces", [])) if ((await levelIn(client.userId, s.id, s)) >= AccessLevel.EDIT) spaceIds.push(s.id);
    }
    if (!spaceIds.length) return { reports: [] };
    const rows = await all<{
      id: string;
      page_id: string;
      space_id: string;
      kind: number;
      text: string;
      author_id: string;
      created_at: number;
      resolved_at: number | null;
      resolved_by: string;
      title: string;
    }>(
      `SELECT r.*, COALESCE(NULLIF(p.published_title, ''), p.title) AS title FROM reports r JOIN pages p ON p.id = r.page_id
       WHERE r.space_id IN (${marks(spaceIds.length)}) ${request.pageId ? "AND r.page_id = ?" : ""}
       AND r.resolved_at IS ${request.resolved ? "NOT NULL" : "NULL"} ORDER BY r.created_at DESC LIMIT 200`,
      [...spaceIds, ...(request.pageId ? [request.pageId] : [])],
    );
    return {
      reports: rows.map((r) => ({
        id: r.id,
        pageId: r.page_id,
        pageTitle: r.title,
        spaceId: r.space_id,
        kind: r.kind as ReportKind,
        text: r.text,
        authorId: r.author_id,
        createdAt: BigInt(r.created_at),
        resolvedAt: BigInt(r.resolved_at ?? 0),
        resolvedBy: r.resolved_by,
      })),
    };
  }

  async resolveReport(request: ResolveReportRequest, client: Client): Promise<Ack> {
    const row = await get<{ id: string; space_id: string; page_id: string }>("SELECT * FROM reports WHERE id = ?", [request.id]);
    if (!row) throw new Error("This report no longer exists.");
    await requireLevel(client.userId, row.space_id, AccessLevel.EDIT);
    await run("UPDATE reports SET resolved_at = ?, resolved_by = ? WHERE id = ?", [
      request.resolved ? Date.now() : null,
      request.resolved ? client.userId : "",
      row.id,
    ]);
    await this.pageChanged(row.page_id, row.space_id);
    return OK;
  }

  async follow(request: FollowRequest, client: Client): Promise<Ack> {
    await this.requireFollowable(request.kind, request.id, client.userId);
    if (request.follow)
      await run("INSERT OR IGNORE INTO follows (user_id, kind, target_id) VALUES (?, ?, ?)", [client.userId, request.kind, request.id]);
    else await run("DELETE FROM follows WHERE user_id = ? AND kind = ? AND target_id = ?", [client.userId, request.kind, request.id]);
    return OK;
  }

  async following(request: FollowingRequest, client: Client): Promise<FollowingResponse> {
    await this.requireFollowable(request.kind, request.id, client.userId);
    const row = await get("SELECT 1 FROM follows WHERE user_id = ? AND kind = ? AND target_id = ?", [client.userId, request.kind, request.id]);
    return { following: !!row };
  }

  private async requireFollowable(kind: string, id: string, userId: UserGuid) {
    if (kind === "page") {
      const row = await findPage(id);
      if (!canSeePage(await pageAccess(userId, row), row)) throw new AccessError("You do not have access to this page.");
    } else if (kind === "category") {
      const row = await get<CategoryRow>("SELECT * FROM categories WHERE id = ?", [id]);
      if (!row) throw new Error("This category no longer exists.");
      await requireLevel(userId, row.space_id, AccessLevel.READ);
    } else throw new Error("Only pages and categories can be followed.");
  }

  // ---------- Broadcasts ----------

  private spaceChanged(spaceId: string) {
    spaceAudience(spaceId)
      .then((audience) => this.broadcastSpaceChanged({ spaceId }, audience))
      .catch((err) => console.error("broadcastSpaceChanged failed", err));
  }

  private async pageChanged(pageId: string, spaceId: string) {
    this.broadcastPageChanged({ pageId, spaceId }, await spaceAudience(spaceId));
  }
}

export const wikiService = new WikiService();
