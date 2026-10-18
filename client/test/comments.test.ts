// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import { Editor } from "@tiptap/core";
import { enableSuggestChanges } from "@handlewithcare/prosemirror-suggest-changes";

vi.mock("@rootsdk/client-app", () => ({ rootClient: {}, ImageUriResolution: { Large: "large" } }));

const { buildExtensions } = await import("../src/editor/extensions");
const { listSuggestions } = await import("../src/editor/suggestionList");
const { addThread, readThreads, reopenThread, reply, resolveThread, threadRanges } = await import("../src/editor/comments");

type Peer = { ydoc: Y.Doc; editor: Editor };

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

describe("comments", () => {
  it("shares threads, replies and highlights between editors", () => {
    const [alice, bob] = setup();
    alice.editor.commands.setContent("<p>Hello world. This is the lede.</p>");

    const id = addThread(alice.editor, alice.ydoc, "alice", 1, 6, "Too casual?");
    reply(bob.ydoc, id, "bob", "Agreed");

    const [thread] = readThreads(alice.ydoc);
    expect(thread.quote).toBe("Hello");
    expect(thread.messages.map((m) => m.body)).toEqual(["Too casual?", "Agreed"]);
    expect(threadRanges(bob.editor.state.doc).get(id)).toEqual({ from: 1, to: 6 });
    expect(bob.editor.getHTML()).toContain(`data-comment="${id}"`);

    resolveThread(bob.editor, bob.ydoc, id, "bob");
    expect(readThreads(alice.ydoc)[0].resolved).toBe(true);
    // The anchor stays so the thread can be reopened in place.
    expect(threadRanges(alice.editor.state.doc).has(id)).toBe(true);
    reopenThread(alice.ydoc, id);
    expect(readThreads(bob.ydoc)[0].resolved).toBe(false);
  });

  it("keeps who was mentioned", () => {
    const [{ editor, ydoc }] = setup();
    editor.commands.setContent("<p>Mention me</p>");
    const id = addThread(editor, ydoc, "alice", 1, 8, "@Bob look", ["bob"]);
    reply(ydoc, id, "bob", "@Alice done", ["alice"]);
    expect(readThreads(ydoc)[0].messages.map((m) => m.mentions)).toEqual([["bob"], ["alice"]]);
  });

  it("is not turned into a suggestion in suggesting mode", () => {
    const [alice] = setup();
    alice.editor.commands.setContent("<p>Hello world.</p>");
    enableSuggestChanges(alice.editor.state, alice.editor.view.dispatch);

    addThread(alice.editor, alice.ydoc, "alice", 1, 6, "Check this");
    expect(listSuggestions(alice.editor.state.doc)).toHaveLength(0);
    expect(alice.editor.getText()).toBe("Hello world.");
  });
});
