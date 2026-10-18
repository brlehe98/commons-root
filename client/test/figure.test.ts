// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large", Original: "original" } }));

const { buildExtensions } = await import("../src/editor/extensions");

describe("replacing a photo", () => {
  it("swaps the image and keeps the caption", () => {
    const ydoc = new Y.Doc();
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "alice"),
    });
    editor.commands.setContent("<p>Before</p>");
    editor.chain().setTextSelection(editor.state.doc.content.size).insertFigure("root://asset/old").run();

    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (node.type.name === "figure") pos = p;
    });
    editor.chain().setTextSelection(pos + 1).insertContent("A caption").run();

    editor.chain().setNodeSelection(pos).replaceFigure("root://asset/new").run();

    const figure = editor.state.doc.nodeAt(pos)!;
    expect(figure.attrs.uri).toBe("root://asset/new");
    expect(figure.textContent).toBe("A caption");
  });
});
