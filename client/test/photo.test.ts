// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";
import { enableSuggestChanges } from "@handlewithcare/prosemirror-suggest-changes";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large" } }));
const { buildExtensions } = await import("../src/editor/extensions");

function make() {
  const ydoc = new Y.Doc();
  return new Editor({ element: document.createElement("div"), extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "alice") });
}

it("inserts a photo at the end of a paragraph", () => {
  const editor = make();
  editor.commands.setContent("<p>Intro</p>");
  editor.commands.focus("end");
  const ok = editor.chain().focus().insertFigure("root://asset/1").run();
  expect(ok).toBe(true);
  expect(editor.state.doc.child(1).type.name).toBe("figure");
});

it("inserts a photo in suggestion mode", () => {
  const editor = make();
  editor.commands.setContent("<p>Intro</p>");
  enableSuggestChanges(editor.state, editor.view.dispatch);
  editor.commands.focus("end");
  const ok = editor.chain().focus().insertFigure("root://asset/1").run();
  expect(ok).toBe(true);
  const figure = editor.state.doc.child(1);
  expect(figure.type.name).toBe("figure");
  expect(figure.marks[0]?.type.name).toBe("insertion");
});
