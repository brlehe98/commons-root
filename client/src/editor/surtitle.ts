import { Extension } from "@tiptap/core";

/**
 * A surtitle (kicker): the short line above a headline. A paragraph with a
 * flag rather than a new block type, so older texts and suggestions keep
 * working. The inline style keeps the look when the article is copied to Word.
 */
export const Surtitle = Extension.create({
  name: "surtitle",
  addGlobalAttributes: () => [
    {
      types: ["paragraph"],
      attributes: {
        surtitle: {
          // null rather than false: y-prosemirror restores a missing attribute as null.
          default: null,
          parseHTML: (el) => (el.hasAttribute("data-surtitle") ? true : null),
          renderHTML: (attrs) =>
            attrs.surtitle
              ? {
                  "data-surtitle": "",
                  class: "surtitle",
                  style: "font-size: 0.8em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em",
                }
              : {},
        },
      },
    },
  ],
});
