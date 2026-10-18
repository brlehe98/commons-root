import type { Node as PMNode } from "@tiptap/pm/model";
import { authorOf } from "./suggestions";

export type SuggestionSummary = {
  id: string | number;
  author: string;
  inserted: string;
  deleted: string;
  structural: boolean;
};

/** Groups suggestion marks by id, in document order. */
export function listSuggestions(doc: PMNode): SuggestionSummary[] {
  const byId = new Map<string, SuggestionSummary>();
  doc.descendants((node) => {
    for (const mark of node.marks) {
      if (!["insertion", "deletion", "modification"].includes(mark.type.name)) continue;
      const key = String(mark.attrs.id);
      let s = byId.get(key);
      if (!s) {
        s = { id: mark.attrs.id, author: authorOf(mark.attrs.id), inserted: "", deleted: "", structural: false };
        byId.set(key, s);
      }
      if (!node.isText || mark.type.name === "modification") s.structural = true;
      const text = node.isText ? node.text!.replace(/​/g, "") : "";
      if (mark.type.name === "insertion") s.inserted += text;
      if (mark.type.name === "deletion") s.deleted += text;
    }
  });
  return Array.from(byId.values());
}

/** Word count of the text as it would read once suggestions are accepted. */
export function countWords(doc: PMNode, from = 0, to = doc.content.size): number {
  let text = "";
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) {
      if (node.isBlock) text += " ";
      return true;
    }
    if (node.marks.some((m) => m.type.name === "deletion")) return false;
    const start = Math.max(from, pos) - pos;
    const end = Math.min(to, pos + node.nodeSize) - pos;
    text += node.text!.slice(start, end);
    return false;
  });
  return text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}
