import { UserGuid } from "@rootsdk/server-app";
import {
  AccessLevel,
  Community,
  FieldDef,
  FieldKind,
  FieldValue,
  Page,
  PageSummary,
  PageType,
} from "@commons-root/gen-shared";
import { EventEmitter } from "events";
import * as Y from "yjs";
import { all, get, marks, run } from "./db";
import { canSeePage, levelIn, pageAccess, PageAccess } from "./access";
import { getDoc } from "./docStore";

export type PageRow = {
  id: string;
  space_id: string;
  title: string;
  type_id: string;
  category_id: string;
  fields: string;
  community: number;
  lang: string;
  translation_group: string;
  created_at: number;
  created_by: string;
  updated_at: number;
  revision_id: number | null;
  published_at: number | null;
  published_by: string;
  published_title: string;
  published_fields: string;
  lead: string;
  draft_changed: number;
};

export type PageTypeRow = { id: string; name: string; icon: string; fields: string; position: number };

/** Things that happen to pages, for notifications. */
export type WikiEvents = {
  published: [{ page: PageRow; userId: string; note: string }];
  reported: [{ page: PageRow; userId: string; kind: number }];
};
export const wikiEvents = new EventEmitter<WikiEvents>();

export const TITLE_MAX = 200;
const VALUE_MAX = 500;
const TAG_MAX = 40;
const TAGS_PER_PAGE = 20;
// Root's eight languages; the content of a page can be in any of them.
export const LANGS = new Set(["de", "en", "es", "fr", "it", "pl", "pt", "tr"]);

export const pageDoc = (pageId: string) => `page:${pageId}`;
export const templateDoc = (typeId: string) => `template:${typeId}`;

export async function findPage(id: string): Promise<PageRow> {
  const row = await get<PageRow>("SELECT * FROM pages WHERE id = ?", [id]);
  if (!row) throw new Error("This page no longer exists.");
  return row;
}

export function parseJson<T>(text: string, fallback: T): T {
  try {
    const value = JSON.parse(text);
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export async function tagsOf(pageIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (!pageIds.length) return map;
  const rows = await all<{ page_id: string; tag: string }>(
    `SELECT page_id, tag FROM page_tags WHERE page_id IN (${marks(pageIds.length)}) ORDER BY tag`,
    pageIds,
  );
  for (const r of rows) map.set(r.page_id, [...(map.get(r.page_id) ?? []), r.tag]);
  return map;
}

/** "Open source", "open  source " and "Open Source" are one tag: "open source". */
export function cleanTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const t of tags) {
    const tag = t.replace(/\s+/g, " ").trim().toLowerCase().slice(0, TAG_MAX);
    if (tag) out.add(tag);
    if (out.size >= TAGS_PER_PAGE) break;
  }
  return Array.from(out);
}

export async function setTags(pageId: string, tags: string[]) {
  await run("DELETE FROM page_tags WHERE page_id = ?", [pageId]);
  for (const tag of cleanTags(tags)) await run("INSERT INTO page_tags (page_id, tag) VALUES (?, ?)", [pageId, tag]);
}

export function toPageType(r: PageTypeRow): PageType {
  return { id: r.id, name: r.name, icon: r.icon, fields: parseJson<FieldDef[]>(r.fields, []), position: r.position };
}

const isUrl = (v: string) => {
  try {
    const url = new URL(v);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

/** Keeps the values the page's type has, each in its field's format. */
export function cleanValues(values: FieldValue[], type: PageType | undefined): FieldValue[] {
  if (!type) return [];
  const out: FieldValue[] = [];
  for (const def of type.fields) {
    const raw = values.find((v) => v.fieldId === def.id)?.value ?? "";
    let value = raw.trim().slice(0, VALUE_MAX);
    if (!value) continue;
    switch (def.kind) {
      case FieldKind.FIELD_LINK:
        if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
        if (!isUrl(value)) continue;
        break;
      case FieldKind.FIELD_NUMBER:
        if (!/^-?\d+([.,]\d+)?$/.test(value)) continue;
        break;
      case FieldKind.FIELD_DATE:
        if (!/^\d{4}(-\d{2}(-\d{2})?)?$/.test(value)) continue;
        break;
      case FieldKind.FIELD_CHOICE:
        if (!def.options.includes(value)) continue;
        break;
      case FieldKind.FIELD_IMAGE: {
        // The photo's address, then its caption on a line of its own.
        const at = value.indexOf("\n");
        const uri = (at < 0 ? value : value.slice(0, at)).trim();
        if (!/^root:\/\/[^\s"'<>\\]{1,400}$/.test(uri)) continue;
        const caption = at < 0 ? "" : value.slice(at + 1).replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, 300);
        value = caption ? `${uri}\n${caption}` : uri;
        break;
      }
    }
    out.push({ fieldId: def.id, value });
  }
  return out;
}

export async function findType(id: string): Promise<PageType | undefined> {
  if (!id) return undefined;
  const row = await get<PageTypeRow>("SELECT * FROM page_types WHERE id = ?", [id]);
  return row ? toPageType(row) : undefined;
}

export function toSummary(r: PageRow, tags: string[], access?: PageAccess): PageSummary {
  const published = r.revision_id != null;
  return {
    id: r.id,
    spaceId: r.space_id,
    // Readers see the published title; a page never published shows its draft's.
    title: published ? r.published_title || r.title : r.title,
    typeId: r.type_id,
    categoryId: r.category_id,
    tags,
    publishedAt: BigInt(r.published_at ?? 0),
    updatedAt: BigInt(r.updated_at),
    lead: r.lead,
    lang: r.lang,
    draftOnly: !published,
    snippet: "",
  };
}

/**
 * The rows the member can see, each with its access. Levels are worked out
 * once per space and community setting, not once per page.
 */
export async function visible(userId: UserGuid, rows: PageRow[]): Promise<{ row: PageRow; access: PageAccess }[]> {
  const cache = new Map<string, PageAccess>();
  const out: { row: PageRow; access: PageAccess }[] = [];
  for (const row of rows) {
    const key = `${row.space_id}/${row.community}`;
    let access = cache.get(key);
    if (!access) cache.set(key, (access = await pageAccess(userId, row)));
    if (canSeePage(access, row)) out.push({ row, access });
  }
  return out;
}

export async function summaries(userId: UserGuid, rows: PageRow[]): Promise<PageSummary[]> {
  const seen = await visible(userId, rows);
  const tags = await tagsOf(seen.map((s) => s.row.id));
  return seen.map((s) => toSummary(s.row, tags.get(s.row.id) ?? [], s.access));
}

export async function toPage(row: PageRow, userId: UserGuid, access: PageAccess): Promise<Page> {
  const tags = (await tagsOf([row.id])).get(row.id) ?? [];
  const group = await all<PageRow>("SELECT * FROM pages WHERE translation_group = ? AND id != ?", [row.translation_group, row.id]);
  const translations = (await visible(userId, group)).map(({ row: r }) => ({
    pageId: r.id,
    lang: r.lang,
    title: r.revision_id != null ? r.published_title || r.title : r.title,
  }));
  const linking = await all<PageRow>(
    "SELECT p.* FROM page_links l JOIN pages p ON p.id = l.from_id WHERE l.to_id = ? AND p.revision_id IS NOT NULL ORDER BY p.published_title",
    [row.id],
  );
  const following = !!(await get("SELECT 1 FROM follows WHERE user_id = ? AND kind = 'page' AND target_id = ?", [userId, row.id]));
  const reports = access.canPublish
    ? ((await get<{ n: number }>("SELECT COUNT(*) AS n FROM reports WHERE page_id = ? AND resolved_at IS NULL", [row.id]))?.n ?? 0)
    : 0;
  return {
    id: row.id,
    spaceId: row.space_id,
    title: row.title,
    typeId: row.type_id,
    categoryId: row.category_id,
    tags,
    fields: access.level >= AccessLevel.COMMENT ? parseJson<FieldValue[]>(row.fields, []) : [],
    publishedFields: parseJson<FieldValue[]>(row.published_fields, []),
    publishedTitle: row.published_title,
    community: row.community as Community,
    lang: row.lang,
    translations,
    publishedAt: BigInt(row.published_at ?? 0),
    publishedBy: row.published_by,
    createdAt: BigInt(row.created_at),
    createdBy: row.created_by,
    level: access.level,
    canPublish: access.canPublish,
    following,
    draftChanged: !!row.draft_changed,
    backlinks: await summaries(userId, linking),
    openReports: reports,
  };
}

/** Starts a page's draft from its type's template. */
export async function copyTemplate(typeId: string, pageId: string) {
  if (!typeId) return;
  const template = await getDoc(templateDoc(typeId));
  const body = template.ydoc.getXmlFragment("body");
  if (!body.length) return;
  const draft = await getDoc(pageDoc(pageId));
  // Only the text: the template's comments stay with the template.
  const copy = new Y.Doc();
  Y.applyUpdate(copy, Y.encodeStateAsUpdate(template.ydoc));
  copy.getMap("comments").clear();
  Y.applyUpdate(draft.ydoc, Y.encodeStateAsUpdate(copy));
  copy.destroy();
}

/** Writes headings, each followed by an empty paragraph, as a template. */
export async function writeTemplate(typeId: string, headings: string[]) {
  const doc = await getDoc(templateDoc(typeId));
  const body = doc.ydoc.getXmlFragment("body");
  if (body.length) return;
  doc.ydoc.transact(() => {
    const blocks: Y.XmlElement[] = [new Y.XmlElement("paragraph")];
    for (const h of headings) {
      const heading = new Y.XmlElement("heading");
      heading.setAttribute("level", 2 as unknown as string);
      heading.insert(0, [new Y.XmlText(h)]);
      blocks.push(heading, new Y.XmlElement("paragraph"));
    }
    body.insert(0, blocks);
  });
}

/** Writes plain paragraphs into an empty shared text (a home page's welcome block). */
export async function writeParagraphs(docId: string, paragraphs: string[]) {
  const doc = await getDoc(docId);
  const body = doc.ydoc.getXmlFragment("body");
  if (body.length) return;
  doc.ydoc.transact(() =>
    body.insert(
      0,
      paragraphs.map((text) => {
        const p = new Y.XmlElement("paragraph");
        p.insert(0, [new Y.XmlText(text)]);
        return p;
      }),
    ),
  );
}

/** The levels of the space's members who can publish, for notifications. */
export async function spaceLevel(userId: UserGuid, spaceId: string) {
  return levelIn(userId, spaceId);
}
