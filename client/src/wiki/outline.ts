import type { PMNode } from "./api";

export const PAGE_LINK = /^#\/page\/([A-Za-z0-9_-]{1,64})$/;

export type Heading = { level: number; text: string };
export type Note = { text: string; url: string };

const textOf = (n: PMNode): string => (n.type === "text" ? n.text ?? "" : (n.content ?? []).map(textOf).join(""));

/** What the page shows around its text: headings for the contents, notes for References, links to check. */
export function outline(doc: PMNode) {
  const headings: Heading[] = [];
  const notes: Note[] = [];
  const links = new Set<string>();
  const walk = (n: PMNode) => {
    if (n.type === "heading") headings.push({ level: Number(n.attrs?.level ?? 2), text: textOf(n).trim() });
    if (n.type === "footnote") notes.push({ text: String(n.attrs?.text ?? ""), url: String(n.attrs?.url ?? "") });
    for (const m of n.marks ?? []) {
      const id = m.type === "link" ? PAGE_LINK.exec(String(m.attrs?.href ?? ""))?.[1] : undefined;
      if (id) links.add(id);
    }
    (n.content ?? []).forEach(walk);
  };
  walk(doc);
  return { headings, notes, links: [...links] };
}
