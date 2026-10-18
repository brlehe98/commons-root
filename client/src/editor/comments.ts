import { Mark, mergeAttributes } from "@tiptap/core";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { suggestChangesKey } from "@handlewithcare/prosemirror-suggest-changes";
import * as Y from "yjs";

/**
 * Comment threads. The commented text carries a "comment" mark with the
 * thread id; the messages live in the shared Yjs document under "comments",
 * so they sync live with the text but stay out of undo and of the copy.
 */
export const CommentMark = Mark.create({
  name: "comment",
  inclusive: false,
  // Comments may overlap: different threads on the same words.
  excludes: "",
  addAttributes: () => ({
    threadId: {
      default: null,
      parseHTML: (el: HTMLElement) => el.getAttribute("data-comment"),
      renderHTML: (attrs: Record<string, unknown>) => ({ "data-comment": attrs.threadId }),
    },
  }),
  parseHTML: () => [{ tag: "span[data-comment]" }],
  renderHTML: ({ HTMLAttributes }) => ["span", mergeAttributes(HTMLAttributes, { class: "comment" }), 0],
});

export type CommentMessage = { id: string; authorId: string; body: string; createdAt: number; mentions?: string[] };

export type Thread = {
  id: string;
  authorId: string;
  createdAt: number;
  quote: string;
  resolved: boolean;
  resolvedBy: string;
  messages: CommentMessage[];
};

export function threadsMap(ydoc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return ydoc.getMap("comments");
}

export function readThreads(ydoc: Y.Doc): Thread[] {
  const out: Thread[] = [];
  threadsMap(ydoc).forEach((t, id) => {
    out.push({
      id,
      authorId: String(t.get("authorId") ?? ""),
      createdAt: Number(t.get("createdAt") ?? 0),
      quote: String(t.get("quote") ?? ""),
      resolved: Boolean(t.get("resolved")),
      resolvedBy: String(t.get("resolvedBy") ?? ""),
      messages: ((t.get("messages") as Y.Array<CommentMessage> | undefined)?.toArray() ?? []).slice(),
    });
  });
  return out;
}

/** First position of each thread's mark in the document, for ordering and scrolling. */
export function threadRanges(doc: PMNode): Map<string, { from: number; to: number }> {
  const ranges = new Map<string, { from: number; to: number }>();
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name !== "comment") continue;
      const id = String(mark.attrs.threadId);
      const r = ranges.get(id);
      if (r) r.to = Math.max(r.to, pos + node.nodeSize);
      else ranges.set(id, { from: pos, to: pos + node.nodeSize });
    }
  });
  return ranges;
}

/** Thread ids under the cursor, innermost last. */
export function threadsAt(editor: Editor): string[] {
  const { $from } = editor.state.selection;
  return $from.marks().filter((m) => m.type.name === "comment").map((m) => String(m.attrs.threadId));
}

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

/** Anchors a new thread on the given range with its first message. */
export function addThread(
  editor: Editor,
  ydoc: Y.Doc,
  userId: string,
  from: number,
  to: number,
  body: string,
  mentions: string[] = [],
): string {
  const id = newId();
  // The text may have changed while the comment was being written.
  const size = editor.state.doc.content.size;
  from = Math.min(from, size);
  to = Math.min(Math.max(to, from), size);
  const quote = editor.state.doc.textBetween(from, to, " ").slice(0, 280);
  ydoc.transact(() => {
    const thread = new Y.Map<unknown>();
    thread.set("authorId", userId);
    thread.set("createdAt", Date.now());
    thread.set("quote", quote);
    thread.set("resolved", false);
    const messages = new Y.Array<CommentMessage>();
    messages.push([{ id: newId(), authorId: userId, body, createdAt: Date.now(), mentions }]);
    thread.set("messages", messages);
    threadsMap(ydoc).set(id, thread);
  });
  const tr = editor.state.tr.addMark(from, to, editor.schema.marks.comment.create({ threadId: id }));
  // A comment is not an edit: never turn it into a suggestion or undo it.
  tr.setMeta(suggestChangesKey, { skip: true });
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
  return id;
}

export function reply(ydoc: Y.Doc, threadId: string, userId: string, body: string, mentions: string[] = []) {
  const messages = threadsMap(ydoc).get(threadId)?.get("messages") as Y.Array<CommentMessage> | undefined;
  messages?.push([{ id: newId(), authorId: userId, body, createdAt: Date.now(), mentions }]);
}

/** Brings a resolved thread back with its highlight. */
export function reopenThread(ydoc: Y.Doc, threadId: string) {
  const thread = threadsMap(ydoc).get(threadId);
  if (!thread) return;
  ydoc.transact(() => {
    thread.set("resolved", false);
    thread.set("resolvedBy", "");
  });
}

export function deleteMessage(ydoc: Y.Doc, threadId: string, messageId: string) {
  const messages = threadsMap(ydoc).get(threadId)?.get("messages") as Y.Array<CommentMessage> | undefined;
  if (!messages) return;
  const index = messages.toArray().findIndex((m) => m.id === messageId);
  if (index >= 0) messages.delete(index, 1);
}

/** Removes a thread's highlight from the text, keeping or dropping the thread itself. */
function unmark(editor: Editor, threadId: string) {
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    const mark = node.marks.find((m) => m.type.name === "comment" && String(m.attrs.threadId) === threadId);
    if (mark) tr.removeMark(pos, pos + node.nodeSize, mark);
  });
  if (!tr.docChanged) return;
  tr.setMeta(suggestChangesKey, { skip: true });
  tr.setMeta("addToHistory", false);
  editor.view.dispatch(tr);
}

export function resolveThread(editor: Editor, ydoc: Y.Doc, threadId: string, userId: string) {
  const thread = threadsMap(ydoc).get(threadId);
  if (!thread) return;
  ydoc.transact(() => {
    thread.set("resolved", true);
    thread.set("resolvedBy", userId);
  });
  // The mark stays so the thread can be reopened in place; the panel hides
  // the highlight of resolved threads.
  void editor;
}

export function deleteThread(editor: Editor, ydoc: Y.Doc, threadId: string) {
  threadsMap(ydoc).delete(threadId);
  unmark(editor, threadId);
}
