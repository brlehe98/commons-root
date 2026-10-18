import * as Y from "yjs";

/** A ProseMirror node as JSON. */
export type PMNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
};

// Marks y-prosemirror stores as "name--hash" when one text can carry several.
const HASHED = /(.*)(--[a-zA-Z0-9+/=]{8})$/;
const markName = (key: string) => HASHED.exec(key)?.[1] ?? key;

// Comments and suggestions belong to the draft, never to the published page.
const DRAFT_MARKS = new Set(["comment", "insertion", "deletion", "modification", "ychange"]);

/** Internal links point to "#/page/<id>". */
export const PAGE_LINK = /^#\/page\/([A-Za-z0-9_-]{1,64})$/;

function convert(item: Y.XmlElement | Y.XmlText | Y.XmlHook): PMNode[] {
  if (item instanceof Y.XmlText) {
    const out: PMNode[] = [];
    for (const d of item.toDelta() as { insert: unknown; attributes?: Record<string, Record<string, unknown>> }[]) {
      if (typeof d.insert !== "string") continue;
      const marks = Object.entries(d.attributes ?? {}).map(([key, attrs]) => ({ type: markName(key), attrs: attrs ?? {} }));
      // A suggested insertion is not in the text yet.
      if (marks.some((m) => m.type === "insertion")) continue;
      const kept = marks.filter((m) => !DRAFT_MARKS.has(m.type));
      out.push(kept.length ? { type: "text", text: d.insert, marks: kept } : { type: "text", text: d.insert });
    }
    return out;
  }
  if (!(item instanceof Y.XmlElement)) return [];
  const attrs = { ...item.getAttributes() } as Record<string, unknown>;
  const nodeMarks = (Array.isArray(attrs.__marks) ? attrs.__marks : []) as { type: string; attrs?: Record<string, unknown> }[];
  delete attrs.__marks;
  delete attrs.ychange;
  // A block suggested for insertion is left out the same way.
  if (nodeMarks.some((m) => m?.type === "insertion")) return [];
  const node: PMNode = { type: item.nodeName };
  if (Object.keys(attrs).length) node.attrs = attrs;
  const kept = nodeMarks.filter((m) => m && !DRAFT_MARKS.has(m.type));
  if (kept.length) node.marks = kept;
  const children = item.toArray().flatMap((c) => convert(c as Y.XmlElement | Y.XmlText));
  if (children.length) node.content = children;
  return [node];
}

/** The draft's body as ProseMirror JSON, without comments or pending suggestions. */
export function docToJson(ydoc: Y.Doc): PMNode {
  const body = ydoc.getXmlFragment("body");
  const content = body.toArray().flatMap((c) => convert(c as Y.XmlElement | Y.XmlText));
  return { type: "doc", content: content.length ? content : [{ type: "paragraph" }] };
}

const BLOCKS = new Set(["paragraph", "heading", "listItem", "blockquote", "figure", "attachment", "horizontalRule"]);

/** Plain text, blocks on their own lines. Sources count: they are searched too. */
export function jsonText(node: PMNode): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "footnote") return ` ${String(node.attrs?.text ?? "")} `;
  if (node.type === "attachment") return `${String(node.attrs?.name ?? "")}\n`;
  if (node.type === "hardBreak") return "\n";
  const inner = (node.content ?? []).map(jsonText).join("");
  return BLOCKS.has(node.type) ? `${inner}\n` : inner;
}

/** The first paragraph with words in it, for page lists. */
export function leadOf(node: PMNode, max = 280): string {
  const walk = (n: PMNode): string | null => {
    if (n.type === "paragraph") {
      const text = (n.content ?? [])
        .filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      return text || null;
    }
    for (const c of n.content ?? []) {
      const found = walk(c);
      if (found) return found;
    }
    return null;
  };
  const text = walk(node) ?? "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The pages an internal link points to. */
export function linkedPages(node: PMNode, into = new Set<string>()): Set<string> {
  for (const m of node.marks ?? []) {
    if (m.type !== "link") continue;
    const id = PAGE_LINK.exec(String(m.attrs?.href ?? ""))?.[1];
    if (id) into.add(id);
  }
  for (const c of node.content ?? []) linkedPages(c, into);
  return into;
}
