// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";
import { applySuggestion, enableSuggestChanges, revertSuggestion } from "@handlewithcare/prosemirror-suggest-changes";
import { commentProblem, onlySuggests } from "../../server/src/suggestOnly";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large" } }));

const { buildExtensions } = await import("../src/editor/extensions");
const { listSuggestions } = await import("../src/editor/suggestionList");
const { addThread } = await import("../src/editor/comments");

/**
 * A server copy of the text and one writer. Each change the writer makes is
 * checked the way the server checks a Comment-level member's update.
 */
function setup(html: string) {
  const server = new Y.Doc();
  const ydoc = new Y.Doc();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "carol"),
  });
  editor.commands.setContent(html);
  Y.applyUpdate(server, Y.encodeStateAsUpdate(ydoc));
  /** Runs `change` and says whether the server would accept it. */
  const check = (change: () => void): boolean => {
    const before = Y.encodeStateVector(ydoc);
    change();
    const update = Y.encodeStateAsUpdate(ydoc, before);
    const ok = onlySuggests(server, update);
    Y.applyUpdate(server, update);
    return ok;
  };
  return { editor, ydoc, check };
}

describe("Comment level may only suggest", () => {
  it("accepts typed suggestions, suggested deletions and withdrawing them", () => {
    const { editor, check } = setup("<p>Hello world. This is the lede.</p>");
    enableSuggestChanges(editor.state, editor.view.dispatch);
    const from = editor.getText().indexOf("world") + 1;
    expect(check(() => editor.chain().insertContentAt({ from, to: from + 5 }, "Root").run())).toBe(true);
    expect(check(() => editor.chain().insertContentAt(editor.state.doc.content.size - 1, " More.").run())).toBe(true);
    const [first] = listSuggestions(editor.state.doc);
    expect(check(() => revertSuggestion(first.id)(editor.state, editor.view.dispatch))).toBe(true);
  });

  it("accepts a suggested heading and comments", () => {
    const { editor, ydoc, check } = setup("<p>Title</p><p>Body</p>");
    enableSuggestChanges(editor.state, editor.view.dispatch);
    expect(check(() => editor.chain().setTextSelection(2).setHeading({ level: 2 }).run())).toBe(true);
    expect(check(() => addThread(editor, ydoc, "carol", 8, 12, "Source?"))).toBe(true);
  });

  it("refuses direct edits and accepting a suggestion", () => {
    const { editor, check } = setup("<p>Hello world.</p>");
    expect(check(() => editor.chain().insertContentAt(3, "XX").run())).toBe(false);
    expect(check(() => editor.chain().deleteRange({ from: 1, to: 3 }).run())).toBe(false);
    enableSuggestChanges(editor.state, editor.view.dispatch);
    expect(check(() => editor.chain().insertContentAt(editor.state.doc.content.size - 1, " Bye.").run())).toBe(true);
    const [s] = listSuggestions(editor.state.doc);
    expect(check(() => applySuggestion(s.id)(editor.state, editor.view.dispatch))).toBe(false);
  });

  it("refuses a photo added directly but accepts a suggested one", () => {
    const { editor, check } = setup("<p>Text</p>");
    expect(check(() => editor.chain().setTextSelection(5).insertFigure("root://asset/1").run())).toBe(false);
    enableSuggestChanges(editor.state, editor.view.dispatch);
    expect(check(() => editor.chain().setTextSelection(1).insertFigure("root://asset/2").run())).toBe(true);
  });
});

describe("formatting and comments on the server", () => {
  it("refuses direct bold and links at Comment level, accepts suggested bold", () => {
    const { editor, check } = setup("<p>Hello world.</p>");
    expect(check(() => editor.chain().setTextSelection({ from: 1, to: 6 }).toggleBold().run())).toBe(false);
    enableSuggestChanges(editor.state, editor.view.dispatch);
    expect(check(() => editor.chain().setTextSelection({ from: 7, to: 12 }).toggleItalic().run())).toBe(true);
  });

  it("keeps comments under their author's name", () => {
    const server = new Y.Doc();
    const ydoc = new Y.Doc();
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "carol"),
    });
    editor.commands.setContent("<p>Hello world.</p>");
    Y.applyUpdate(server, Y.encodeStateAsUpdate(ydoc));
    const problem = (userId: string, change: () => void, moderate = false) => {
      const before = Y.encodeStateVector(ydoc);
      change();
      const update = Y.encodeStateAsUpdate(ydoc, before);
      const result = commentProblem(server, update, userId, moderate);
      Y.applyUpdate(server, update);
      return result;
    };
    expect(problem("carol", () => addThread(editor, ydoc, "carol", 1, 6, "Source?"))).toBeNull();
    expect(problem("dave", () => addThread(editor, ydoc, "carol", 7, 12, "Fake"))).not.toBeNull();
    const [id] = Array.from(ydoc.getMap("comments").keys());
    const messages = (ydoc.getMap("comments").get(id) as Y.Map<unknown>).get("messages") as Y.Array<unknown>;
    expect(problem("dave", () => messages.delete(0, 1))).not.toBeNull();
    expect(problem("dave", () => messages.push([{ id: "m2", authorId: "dave", body: "Here", createdAt: 1 }]))).toBeNull();
    expect(problem("dave", () => ydoc.getMap("comments").delete(id))).not.toBeNull();
    expect(problem("erin", () => ydoc.getMap("comments").delete(id), true)).toBeNull();
  });
});
