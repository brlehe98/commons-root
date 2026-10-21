import { useCallback, useEffect, useState } from "react";
import { wikiServiceClient, WikiServiceClientEvent } from "@commons-root/gen-client";
import { Category, FieldDef, FieldKind, FieldValue, PageType, Space } from "@commons-root/gen-shared";
import { recall, remember } from "../snapshots";
import { locale, t } from "../i18n";

export const wiki = wikiServiceClient;

export const errorText = (err: unknown) => String((err as Error)?.message ?? err);

/** Runs a change; an error goes to `onError` instead of being thrown. */
export async function attempt(fn: () => Promise<unknown>, onError: (message: string) => void): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (err) {
    onError(errorText(err));
    return false;
  }
}

/**
 * Loads a value, keeps the last copy for an instant start, and reloads it
 * when the server says something in the space (or the list of spaces) changed.
 */
export function useLoaded<T>(key: string | null, load: () => Promise<T>, events: { spaceId?: string; pageId?: string; spaces?: boolean } = {}) {
  const [value, setValue] = useState<T | undefined>(() => (key ? recall<T>(key) : undefined));
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    load()
      .then((v) => {
        setValue(v);
        setError(null);
        if (key) remember(key, v);
      })
      .catch((err) => setError(errorText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    setValue(key ? recall<T>(key) : undefined);
    reload();
    const onSpace = (e: { spaceId: string }) => (!events.spaceId || e.spaceId === events.spaceId) && reload();
    const onPage = (e: { pageId: string; spaceId: string }) =>
      ((events.pageId && e.pageId === events.pageId) || (events.spaceId && e.spaceId === events.spaceId)) && reload();
    if (events.spaceId) wiki.on(WikiServiceClientEvent.SpaceChanged, onSpace);
    if (events.pageId || events.spaceId) wiki.on(WikiServiceClientEvent.PageChanged, onPage);
    if (events.spaces) wiki.on(WikiServiceClientEvent.SpacesChanged, reload);
    return () => {
      wiki.off(WikiServiceClientEvent.SpaceChanged, onSpace);
      wiki.off(WikiServiceClientEvent.PageChanged, onPage);
      wiki.off(WikiServiceClientEvent.SpacesChanged, reload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, events.spaceId, events.pageId, events.spaces]);
  return { value, error, reload };
}

export function useCategories(spaceId: string) {
  const { value, reload } = useLoaded(`categories:${spaceId}`, () => wiki.listCategories({ spaceId }).then((r) => r.categories), { spaceId });
  return { categories: value ?? [], reload };
}

export function usePageTypes() {
  const { value, reload } = useLoaded("pageTypes", () => wiki.listPageTypes().then((r) => r.types), { spaces: true });
  return { types: value ?? [], reload };
}

/** Categories as a tree: children of `parentId`, in order. */
export const childrenOf = (categories: Category[], parentId: string) =>
  categories.filter((c) => c.parentId === parentId).sort((a, b) => a.position - b.position);

/** The category and those above it, from the top. */
export function pathOf(categories: Category[], id: string): Category[] {
  const out: Category[] = [];
  for (let at = categories.find((c) => c.id === id); at && out.length < 50; at = categories.find((c) => c.id === at!.parentId)) out.unshift(at);
  return out;
}

/** Every category, indented by depth, for a select. */
export function categoryOptions(categories: Category[], none = t("page.noCategory")) {
  const out: { value: string; label: string }[] = [{ value: "", label: none }];
  const walk = (parentId: string, depth: number) => {
    for (const c of childrenOf(categories, parentId)) {
      out.push({ value: c.id, label: `${" ".repeat(depth)}${c.name}` });
      if (depth < 20) walk(c.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}

export const typeOf = (types: PageType[], id: string) => types.find((tp) => tp.id === id);

/** The page's own photo, above the type's fields in its infobox. */
export const PAGE_IMAGE: FieldDef = { id: "image", name: "", icon: "", kind: FieldKind.FIELD_IMAGE, options: [] };
/** A row the page adds to its infobox (its own name and icon); not page metadata. */
export const isExtra = (v: FieldValue) => v.fieldId.startsWith("x-");
export const valueOf = (values: FieldValue[], def: FieldDef) => values.find((v) => v.fieldId === def.id)?.value ?? "";

/** The published text of a page as ProseMirror JSON, put back together when sent in parts. */
export async function loadContent(pageId: string, revisionId = 0) {
  const first = await wiki.getContent({ pageId, revisionId: BigInt(revisionId), transferId: "", chunk: 0 });
  const parts = [first.json];
  for (let chunk = 1; chunk < first.totalChunks; chunk++)
    parts.push((await wiki.getContent({ pageId, revisionId: BigInt(revisionId), transferId: first.transferId, chunk })).json);
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  return { json: JSON.parse(new TextDecoder().decode(bytes)) as PMNode, title: first.title, fields: first.fields };
}

export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

export const spaceName = (spaces: Space[], id: string) => spaces.find((s) => s.id === id)?.name ?? "";

const LANG_NAMES: Record<string, string> = {
  de: "Deutsch",
  en: "English",
  es: "Español",
  fr: "Français",
  it: "Italiano",
  pl: "Polski",
  pt: "Português",
  tr: "Türkçe",
};
export const LANGS = Object.keys(LANG_NAMES);
/** A language by its own name, as Wikipedia lists them. */
export const langName = (code: string) => LANG_NAMES[code] ?? code;

/** "12 March 2026" in the reader's language. */
export const formatDate = (ms: bigint | number) =>
  new Date(Number(ms)).toLocaleDateString(locale(), { year: "numeric", month: "long", day: "numeric" });
