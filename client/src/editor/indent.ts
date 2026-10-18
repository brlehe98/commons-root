import { Extension } from "@tiptap/core";

const MAX_INDENT = 6;
const STEP_EM = 2;
const TYPES = ["paragraph", "heading"];

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    indent: { indent: () => ReturnType; outdent: () => ReturnType };
  }
}

/** Left indent by steps, like Word's "Increase indent". */
export const Indent = Extension.create({
  name: "indent",
  addGlobalAttributes: () => [
    {
      types: TYPES,
      attributes: {
        indent: {
          default: 0,
          parseHTML: (el) => Math.min(MAX_INDENT, Math.round((parseFloat(el.style.marginLeft) || 0) / STEP_EM)),
          renderHTML: (attrs) => (attrs.indent ? { style: `margin-left: ${attrs.indent * STEP_EM}em` } : {}),
        },
      },
    },
  ],
  addCommands() {
    const shift =
      (delta: number) =>
      () =>
      ({ tr, state, dispatch }: any) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!TYPES.includes(node.type.name)) return true;
          const next = Math.max(0, Math.min(MAX_INDENT, (node.attrs.indent ?? 0) + delta));
          if (next !== node.attrs.indent) {
            tr.setNodeAttribute(pos, "indent", next);
            changed = true;
          }
          return false;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      };
    return { indent: shift(1), outdent: shift(-1) };
  },
  addKeyboardShortcuts() {
    return {
      // Inside lists, Tab nests the item instead.
      Tab: () => (this.editor.isActive("listItem") ? false : this.editor.commands.indent()),
      "Shift-Tab": () => (this.editor.isActive("listItem") ? false : this.editor.commands.outdent()),
    };
  },
});
