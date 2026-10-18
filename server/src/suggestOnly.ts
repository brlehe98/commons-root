import * as Y from "yjs";

// prosemirror-suggest-changes marks text it adds with "insertion". y-prosemirror
// stores a mark as a text attribute named after it ("name--hash" when a mark can
// overlap itself), and the node-marks patch stores block marks in "__marks".
const INSERTION = /^insertion(--|$)/;
// Marks that record suggestions and comments rather than formatting.
const NOT_FORMATTING = /^(insertion|deletion|modification|comment)(--|$)/;
const MODIFICATION = /^modification(--|$)/;

function hasInsertionMark(element: Y.XmlElement): boolean {
  const marks = element.getAttribute("__marks") as unknown;
  return Array.isArray(marks) && marks.some((m) => m && (m as { type?: string }).type === "insertion");
}

function collect(node: Y.XmlElement | Y.XmlText | Y.XmlHook, out: string[]) {
  if (node instanceof Y.XmlText) {
    for (const op of node.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
      const keys = Object.keys(op.attributes ?? {});
      if (keys.some((k) => INSERTION.test(k))) continue;
      out.push(typeof op.insert === "string" ? op.insert : "￼");
      // Formatting and links count too, unless a suggestion records the change.
      if (!keys.some((k) => MODIFICATION.test(k))) {
        const format = keys.filter((k) => !NOT_FORMATTING.test(k)).sort();
        if (format.length) out.push(`￼${format.map((k) => `${k}=${JSON.stringify(op.attributes![k])}`).join(",")}￼`);
      }
    }
  } else if (node instanceof Y.XmlElement) {
    if (hasInsertionMark(node)) return;
    const src = node.getAttribute("uri") ?? node.getAttribute("src");
    if (src) out.push(`￼${String(src)}￼`);
    for (const child of node.toArray()) collect(child, out);
  }
}

/**
 * The text a reader gets once every pending suggestion is rejected: suggested
 * insertions are left out, suggested deletions kept. Block boundaries and
 * formatting are ignored, so structural suggestions and comment marks do not
 * count as changes. Photos count by their address.
 */
export function baseText(ydoc: Y.Doc): string {
  const out: string[] = [];
  for (const child of ydoc.getXmlFragment("body").toArray()) collect(child, out);
  // Suggested block splits and joins leave zero-width spaces behind.
  return out.join("").replace(/\u200B/g, "");
}

/**
 * True when `update` only adds, changes or withdraws suggestions and comments:
 * the text under the suggestions stays the same. Used for Comment level, which
 * may suggest but not edit. Accepting a suggestion changes that text, so it is
 * refused too, as the spec reserves it for Edit level.
 */
export function onlySuggests(ydoc: Y.Doc, update: Uint8Array): boolean {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
    const before = baseText(copy);
    Y.applyUpdate(copy, update);
    return baseText(copy) === before;
  } finally {
    copy.destroy();
  }
}

type Message = { id?: string; authorId?: string };
type ThreadState = { authorId: string; resolved: boolean; resolvedBy: string };
type MessageState = { json: string; authorId: string };

/** Text comment threads (map "comments") and pitch question comments (map "questionComments"). */
function snapshot(ydoc: Y.Doc) {
  const threads = new Map<string, ThreadState>();
  const messages = new Map<string, MessageState>();
  const addMessages = (prefix: string, list: unknown) => {
    if (!(list instanceof Y.Array)) return;
    for (const m of list.toArray() as Message[])
      messages.set(`${prefix}:${String(m?.id ?? "")}`, { json: JSON.stringify(m), authorId: String(m?.authorId ?? "") });
  };
  ydoc.getMap("comments").forEach((value, id) => {
    const t = value instanceof Y.Map ? value : null;
    threads.set(id, {
      authorId: String(t?.get("authorId") ?? ""),
      resolved: Boolean(t?.get("resolved")),
      resolvedBy: String(t?.get("resolvedBy") ?? ""),
    });
    addMessages(`t:${id}`, t?.get("messages"));
  });
  ydoc.getMap("questionComments").forEach((list, id) => addMessages(`q:${id}`, list));
  return { threads, messages };
}

/**
 * Why `update` may not change the comments, or null when it may. Everyone
 * writes under their own name: a new thread or message must carry the
 * writer's id, and only its author may change or delete a message. Any
 * commenter may resolve or reopen a thread; deleting a whole thread is for
 * its author or for `canModerate` (Edit level).
 */
export function commentProblem(ydoc: Y.Doc, update: Uint8Array, userId: string, canModerate: boolean): string | null {
  const copy = new Y.Doc();
  try {
    Y.applyUpdate(copy, Y.encodeStateAsUpdate(ydoc));
    const before = snapshot(copy);
    Y.applyUpdate(copy, update);
    const after = snapshot(copy);
    for (const [id, old] of before.threads) {
      const now = after.threads.get(id);
      if (!now) {
        if (old.authorId !== userId && !canModerate) return "Only its author can delete a comment thread.";
        continue;
      }
      if (now.authorId !== old.authorId) return "A comment thread keeps its author.";
      if (now.resolved && !old.resolved && now.resolvedBy !== userId) return "Resolve threads under your own name.";
    }
    for (const [id, now] of after.threads) if (!before.threads.has(id) && now.authorId !== userId) return "Write comments under your own name.";
    for (const [key, old] of before.messages) {
      const now = after.messages.get(key);
      const threadGone = key.startsWith("t:") && !after.threads.has(key.split(":")[1]);
      if (now?.json !== old.json && old.authorId !== userId && !threadGone) return "Only its author can change or delete a comment.";
    }
    for (const [key, now] of after.messages) if (!before.messages.has(key) && now.authorId !== userId) return "Write comments under your own name.";
    return null;
  } finally {
    copy.destroy();
  }
}
