// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";
import {
  applySuggestion,
  enableSuggestChanges,
  revertSuggestions,
} from "@handlewithcare/prosemirror-suggest-changes";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large" } }));

const { buildExtensions } = await import("../src/editor/extensions");
const { listSuggestions, countWords } = await import("../src/editor/suggestionList");

type Peer = { ydoc: Y.Doc; editor: Editor };

/** Two editors whose Yjs documents relay updates the way the server does. */
function setup(): [Peer, Peer] {
  const peers = ["alice", "bob"].map((userId) => {
    const ydoc = new Y.Doc();
    const sync = { ydoc, awareness: new Awareness(ydoc) } as never;
    const editor = new Editor({ element: document.createElement("div"), extensions: buildExtensions(sync, userId) });
    return { ydoc, editor };
  }) as [Peer, Peer];
  const [a, b] = peers;
  a.ydoc.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(b.ydoc, u, "remote"));
  b.ydoc.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(a.ydoc, u, "remote"));
  return peers;
}

const json = (p: Peer) => JSON.stringify(p.editor.getJSON());

describe("live editing with suggestions", () => {
  it("syncs text suggestions with their author", () => {
    const [alice, bob] = setup();
    alice.editor.commands.setContent("<p>Hello world. This is the lede.</p>");
    expect(bob.editor.getText()).toContain("Hello world");

    enableSuggestChanges(bob.editor.state, bob.editor.view.dispatch);
    const from = bob.editor.getText().indexOf("world") + 1;
    bob.editor.chain().insertContentAt({ from, to: from + 5 }, "Root").run();

    expect(json(alice)).toBe(json(bob));
    const suggestions = listSuggestions(alice.editor.state.doc);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({ author: "bob", deleted: "world", inserted: "Root" });
    // Pending deletions do not count as words.
    expect(countWords(alice.editor.state.doc)).toBe(6);

    applySuggestion(suggestions[0].id)(alice.editor.state, alice.editor.view.dispatch);
    expect(bob.editor.getText()).toBe("Hello Root. This is the lede.");
    expect(json(alice)).toBe(json(bob));
  });

  it("syncs a suggested heading change thanks to the y-prosemirror patch", () => {
    const [alice, bob] = setup();
    alice.editor.commands.setContent("<p>Title</p><p>Body</p>");
    enableSuggestChanges(bob.editor.state, bob.editor.view.dispatch);
    bob.editor.chain().setTextSelection(2).setHeading({ level: 2 }).run();

    expect(json(alice)).toBe(json(bob));
    expect(listSuggestions(alice.editor.state.doc)[0]).toMatchObject({ author: "bob", structural: true });

    revertSuggestions(alice.editor.state, alice.editor.view.dispatch);
    expect(bob.editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(json(alice)).toBe(json(bob));
  });

  it("keeps a photo with its caption in sync", () => {
    const [alice, bob] = setup();
    alice.editor.commands.setContent("<p>Intro</p>");
    alice.editor.chain().setTextSelection(6).insertFigure("root://asset/123").run();
    const figure = bob.editor.state.doc.child(1);
    expect(figure.type.name).toBe("figure");
    expect(figure.attrs.uri).toBe("root://asset/123");
    bob.editor.chain().setTextSelection(8).insertContent("Caption by Bob").run();
    expect(alice.editor.state.doc.child(1).textContent).toBe("Caption by Bob");
  });
});
