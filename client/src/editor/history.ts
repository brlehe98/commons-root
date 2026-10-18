import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import { EditorState, Transaction } from "@tiptap/pm/state";
import { revertSuggestions, suggestChangesKey } from "@handlewithcare/prosemirror-suggest-changes";
import * as Y from "yjs";
import { yUndoPluginKey, yXmlFragmentToProseMirrorRootNode } from "y-prosemirror";
import type { EditorView } from "@tiptap/pm/view";

/** Builds the ProseMirror document stored in a version's Yjs state. */
export function versionDoc(state: Uint8Array, schema: Schema): PMNode {
  const ydoc = new Y.Doc();
  try {
    Y.applyUpdate(ydoc, state);
    return yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment("body"), schema);
  } finally {
    ydoc.destroy();
  }
}

/** The document as it stands before any pending suggestion. */
export function cleanDoc(doc: PMNode): PMNode {
  let state = EditorState.create({ schema: doc.type.schema, doc });
  try {
    revertSuggestions(state, (tr: Transaction) => {
      state = state.apply(tr);
    });
  } catch (err) {
    // prosemirror-suggest-changes 0.1 can fail on nested suggestions.
    console.warn("revertSuggestions failed, comparing with suggestions", err);
    return doc;
  }
  return state.doc;
}

/** One string per paragraph, heading, list item or caption. */
export function blockTexts(doc: PMNode): string[] {
  const blocks: string[] = [];
  doc.descendants((node) => {
    if (node.isTextblock) {
      blocks.push(node.textContent);
      return false;
    }
    return true;
  });
  return blocks;
}

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

const MAX_CELLS = 4_000_000;

function tokens(blocks: string[]): string[] {
  const out: string[] = [];
  blocks.forEach((block, i) => {
    if (i) out.push("\n");
    out.push(...(block.match(/\s+|[^\s]+/g) ?? []));
  });
  return out;
}

/**
 * Word-level comparison of two texts. Long texts with many changes fall back
 * to comparing whole paragraphs to keep the browser responsive.
 */
export function diffTexts(before: string[], after: string[]): DiffPart[] {
  let a = tokens(before);
  let b = tokens(after);
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS * 4) {
    a = before.flatMap((t, i) => (i ? ["\n", t] : [t]));
    b = after.flatMap((t, i) => (i ? ["\n", t] : [t]));
  }

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last?.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };

  push("same", a.slice(0, start).join(""));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    push("removed", midA.join(""));
    push("added", midB.join(""));
  } else {
    // Longest common subsequence, filled from the end.
    const width = m + 1;
    const lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        lcs[i * width + j] =
          midA[i] === midB[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push("same", midA[i]);
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) push("removed", midA[i++]);
      else push("added", midB[j++]);
    }
    while (i < n) push("removed", midA[i++]);
    while (j < m) push("added", midB[j++]);
  }
  push("same", a.slice(endA).join(""));
  return parts;
}

/**
 * Transaction that replaces the whole text with a version. It goes through
 * Yjs like any edit, so everyone sees it and Ctrl+Z undoes it, and it is
 * never turned into suggestions.
 */
export function restoreTransaction(state: EditorState, version: PMNode): Transaction {
  return state.tr
    .replaceWith(0, state.doc.content.size, version.content)
    .setMeta(suggestChangesKey, { skip: true })
    .scrollIntoView();
}

/** Restores a version as its own undo step. */
export function restoreVersion(view: EditorView, version: PMNode) {
  // Without this, Ctrl+Z would also undo the typing just before the restore.
  yUndoPluginKey.getState(view.state)?.undoManager?.stopCapturing();
  view.dispatch(restoreTransaction(view.state, version));
}
