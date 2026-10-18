import { Extension, Mark, mergeAttributes } from "@tiptap/core";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";
import {
  suggestChanges,
  suggestChangesKey,
  isSuggestChangesEnabled,
  transformToSuggestionTransaction,
} from "@handlewithcare/prosemirror-suggest-changes";
import { ySyncPluginKey } from "y-prosemirror";
import { colorForUser } from "../users";

/** Marks that block nodes must accept so structural edits can be suggested. */
export const SUGGESTION_MARKS = "insertion modification deletion";

// The published library does not store an author yet, so the suggestion id
// carries it: "<userId>:<counter>:<random>".
let counter = 0;
export function makeIdGenerator(userId: string) {
  return (_schema: Schema, _doc?: PMNode) => `${userId}:${++counter}:${Math.random().toString(36).slice(2, 8)}`;
}

export function authorOf(id: unknown): string {
  return String(id).split(":")[0];
}

function suggestionAttrs(attrs: Record<string, unknown>) {
  const author = authorOf(attrs.id);
  return {
    "data-id": JSON.stringify(attrs.id),
    "data-author": author,
    style: `--suggestion-color: ${colorForUser(author)}`,
  };
}

const idAttribute = {
  id: {
    default: null,
    parseHTML: (el: HTMLElement) => (el.dataset.id ? JSON.parse(el.dataset.id) : null),
    renderHTML: () => ({}),
  },
};

export const Insertion = Mark.create({
  name: "insertion",
  inclusive: false,
  excludes: "deletion modification insertion",
  addAttributes: () => idAttribute,
  parseHTML: () => [{ tag: "ins[data-id]" }],
  renderHTML: ({ mark, HTMLAttributes }) => ["ins", mergeAttributes(HTMLAttributes, suggestionAttrs(mark.attrs)), 0],
});

export const Deletion = Mark.create({
  name: "deletion",
  inclusive: false,
  excludes: "insertion modification deletion",
  addAttributes: () => idAttribute,
  parseHTML: () => [{ tag: "del[data-id]" }],
  renderHTML: ({ mark, HTMLAttributes }) => ["del", mergeAttributes(HTMLAttributes, suggestionAttrs(mark.attrs)), 0],
});

export const Modification = Mark.create({
  name: "modification",
  inclusive: false,
  excludes: "deletion insertion",
  addAttributes: () => ({
    ...idAttribute,
    type: { default: null, renderHTML: () => ({}) },
    attrName: { default: null, renderHTML: () => ({}) },
    previousValue: { default: null, renderHTML: () => ({}) },
    newValue: { default: null, renderHTML: () => ({}) },
  }),
  parseHTML: () => [{ tag: "span[data-type='modification']" }],
  renderHTML: ({ mark, HTMLAttributes }) => [
    "span",
    mergeAttributes(HTMLAttributes, suggestionAttrs(mark.attrs), { "data-type": "modification" }),
    0,
  ],
});

/** Turns edits into suggestions while the local user has suggestion mode on. */
export const SuggestChanges = Extension.create<{ userId: string }>({
  name: "suggestChanges",
  addOptions: () => ({ userId: "" }),
  addProseMirrorPlugins() {
    return [suggestChanges()];
  },
  dispatchTransaction({ transaction, next }) {
    const state = this.editor.state;
    const ySyncMeta = transaction.getMeta(ySyncPluginKey) ?? {};
    // Same rule as the library's withSuggestChanges: remote changes, undo and
    // accept/reject commands go through untouched.
    const transform =
      isSuggestChangesEnabled(state) &&
      !ySyncMeta.isChangeOrigin &&
      !ySyncMeta.isUndoRedoOperation &&
      !("skip" in (transaction.getMeta(suggestChangesKey) ?? {}));
    next(transform ? transformToSuggestionTransaction(transaction, state, makeIdGenerator(this.options.userId)) : transaction);
  },
});
