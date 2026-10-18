// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large", Original: "original" } }));

const { buildExtensions } = await import("../src/editor/extensions");
const { findIssues } = await import("../src/editor/spellcheck/plugin");

function editorWith(html: string) {
  const ydoc = new Y.Doc();
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: buildExtensions({ ydoc, awareness: new Awareness(ydoc) } as never, "alice"),
  });
  editor.commands.setContent(html);
  return editor;
}

describe("spell check", () => {
  it("maps each issue back to its place in the document", async () => {
    const editor = editorWith("<p>Un texte</p><p>avec une ereur ici</p>");
    const check = vi.fn(async (text: string) => {
      const at = text.indexOf("ereur");
      return at < 0 ? [] : [{ from: at, to: at + 5, message: "x", suggestions: ["erreur"] }];
    });
    const found = await findIssues(editor.state.doc, check, new Map(), "fr");
    expect(found).toHaveLength(1);
    expect(editor.state.doc.textBetween(found[0].pos.from, found[0].pos.to)).toBe("ereur");
  });

  it("reuses results for paragraphs that did not change", async () => {
    const editor = editorWith("<p>Un</p><p>Deux</p>");
    const check = vi.fn(async () => []);
    const cache = new Map();
    await findIssues(editor.state.doc, check, cache, "fr");
    await findIssues(editor.state.doc, check, cache, "fr");
    expect(check).toHaveBeenCalledTimes(2);
  });
});
