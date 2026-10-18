// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";
import { undo } from "y-prosemirror";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large" } }));
const { buildExtensions } = await import("../src/editor/extensions");
const { versionDoc, cleanDoc, blockTexts, diffTexts, restoreTransaction, restoreVersion } = await import("../src/editor/history");

function makeEditor(ydoc = new Y.Doc()) {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "alice"),
  });
  return { editor, ydoc };
}

it("reads a saved version back as a document", () => {
  const { editor, ydoc } = makeEditor();
  editor.commands.setContent("<h2>Title</h2><p>First version</p>");
  const saved = Y.encodeStateAsUpdate(ydoc);
  editor.commands.setContent("<p>Changed</p>");

  const doc = versionDoc(saved, editor.schema);
  expect(blockTexts(doc)).toEqual(["Title", "First version"]);
  expect(doc.firstChild?.type.name).toBe("heading");
});

it("restores a version for every collaborator, and Ctrl+Z undoes it", () => {
  const { editor, ydoc } = makeEditor();
  const other = new Y.Doc();
  ydoc.on("update", (u: Uint8Array) => Y.applyUpdate(other, u));
  editor.commands.setContent("<p>Old text</p>");
  const saved = Y.encodeStateAsUpdate(ydoc);
  editor.commands.setContent("<p>New text</p>");

  restoreVersion(editor.view, versionDoc(saved, editor.schema));
  expect(editor.getText()).toBe("Old text");
  expect(other.getXmlFragment("body").toString()).toContain("Old text");
  expect(undo(editor.state)).toBe(true);
  expect(editor.getText()).toBe("New text");
});

it("restores as a direct edit even in suggestion mode", async () => {
  const { enableSuggestChanges } = await import("@handlewithcare/prosemirror-suggest-changes");
  const { editor, ydoc } = makeEditor();
  editor.commands.setContent("<p>Old</p>");
  const saved = Y.encodeStateAsUpdate(ydoc);
  editor.commands.setContent("<p>New</p>");
  enableSuggestChanges(editor.state, editor.view.dispatch);

  editor.view.dispatch(restoreTransaction(editor.state, versionDoc(saved, editor.schema)));
  expect(editor.getHTML()).not.toContain("<ins");
  expect(editor.getText()).toBe("Old");
});

it("compares without pending suggestions", () => {
  const { editor } = makeEditor();
  editor.commands.setContent('<p>Keep <ins data-id="&quot;bob:1:x&quot;">pending </ins>this</p>');
  expect(blockTexts(cleanDoc(editor.state.doc))).toEqual(["Keep this"]);
});

it("diffs word by word", () => {
  const parts = diffTexts(["The cat sat", "Second line"], ["The dog sat", "Second line", "New"]);
  expect(parts).toEqual([
    { kind: "same", text: "The " },
    { kind: "removed", text: "cat" },
    { kind: "added", text: "dog" },
    { kind: "same", text: " sat\nSecond line" },
    { kind: "added", text: "\nNew" },
  ]);
});
