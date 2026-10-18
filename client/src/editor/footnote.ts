import { Node, mergeAttributes } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    footnote: { insertFootnote: (attrs: { text: string; url: string }) => ReturnType };
  }
}

/**
 * A source cited in the text: a numbered note, listed under References at
 * the bottom of the page, as on Wikipedia. The number comes from a CSS
 * counter, so it follows the order of the notes in the text.
 */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes: () => ({
    text: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-text") ?? "" },
    url: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-url") ?? "" },
  }),
  parseHTML: () => [{ tag: "sup[data-footnote]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "sup",
    mergeAttributes(HTMLAttributes, {
      "data-footnote": "",
      class: "footnote",
      "data-text": node.attrs.text,
      "data-url": node.attrs.url,
      title: node.attrs.text,
    }),
  ],
  addCommands() {
    return {
      insertFootnote:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
