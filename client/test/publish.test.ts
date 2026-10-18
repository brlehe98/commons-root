import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { docToJson, jsonText, leadOf, linkedPages } from "../../server/src/content";
import { outline } from "../src/wiki/outline";

/** A draft as y-prosemirror stores it: one paragraph per entry of `runs`. */
function draft(blocks: { name?: string; attrs?: Record<string, unknown>; runs: [string, Record<string, unknown>?][] }[]) {
  const ydoc = new Y.Doc();
  const body = ydoc.getXmlFragment("body");
  body.insert(
    0,
    blocks.map((b) => {
      const el = new Y.XmlElement(b.name ?? "paragraph");
      for (const [k, v] of Object.entries(b.attrs ?? {})) el.setAttribute(k, v as string);
      const text = new Y.XmlText();
      let at = 0;
      for (const [s, marks] of b.runs) {
        text.insert(at, s, marks ?? {});
        at += s.length;
      }
      el.insert(0, [text]);
      return el;
    }),
  );
  return ydoc;
}

describe("publishing a draft", () => {
  it("keeps the text and its formatting, drops comments and pending suggestions", () => {
    const ydoc = draft([
      {
        runs: [
          ["Read ", {}],
          ["this", { bold: {}, "comment--abcd1234": { id: "c1" } }],
          [" now", { insertion: { id: "s1" } }],
          [" guide", { deletion: { id: "s2" } }],
        ],
      },
    ]);
    const json = docToJson(ydoc);
    expect(json.content).toEqual([
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Read " },
          { type: "text", text: "this", marks: [{ type: "bold", attrs: {} }] },
          // A suggested deletion is not accepted yet: the words stay.
          { type: "text", text: " guide" },
        ],
      },
    ]);
  });

  it("leaves out a block suggested for insertion", () => {
    const ydoc = draft([{ runs: [["Kept", {}]] }, { attrs: { __marks: [{ type: "insertion", attrs: { id: "s" } }] as unknown as string }, runs: [["New", {}]] }]);
    expect(jsonText(docToJson(ydoc)).trim()).toBe("Kept");
  });

  it("finds the lead, the internal links, the headings and the sources", () => {
    const ydoc = draft([
      { name: "heading", attrs: { level: 2 as unknown as string }, runs: [["Steps", {}]] },
      { runs: [["See ", {}], ["the tools", { link: { href: "#/page/abc-123" } }], [" and ", {}], ["Root", { link: { href: "https://rootapp.com" } }]] },
    ]);
    const json = docToJson(ydoc);
    expect(leadOf(json)).toBe("See the tools and Root");
    expect([...linkedPages(json)]).toEqual(["abc-123"]);
    const withNote = { ...json, content: [...(json.content ?? []), { type: "paragraph", content: [{ type: "footnote", attrs: { text: "Smith 2020", url: "" } }] }] };
    const o = outline(withNote);
    expect(o.headings).toEqual([{ level: 2, text: "Steps" }]);
    expect(o.notes).toEqual([{ text: "Smith 2020", url: "" }]);
    expect(o.links).toEqual(["abc-123"]);
  });
});
