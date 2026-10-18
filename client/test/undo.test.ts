// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";
import { undo, redo } from "y-prosemirror";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large" } }));
const { buildExtensions } = await import("../src/editor/extensions");

it("keeps undo working after the editor view is remounted, as React does", () => {
  const ydoc = new Y.Doc();
  const el = document.createElement("div");
  const editor = new Editor({ element: el, extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "alice") });
  editor.unmount();
  editor.mount(el);

  editor.commands.insertContent("Hello");
  expect(editor.getText()).toBe("Hello");
  expect(undo(editor.state)).toBe(true);
  expect(editor.getText()).toBe("");
  expect(redo(editor.state)).toBe(true);
  expect(editor.getText()).toBe("Hello");
});
