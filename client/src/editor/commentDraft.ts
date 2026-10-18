import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Keeps the words being commented on highlighted while the comment is
 * written in the side panel: the browser hides a text selection once the
 * focus moves to the comment box. Set with `setCommentDraft(view, range)`.
 */
type Range = { from: number; to: number } | null;
export const commentDraftKey = new PluginKey<Range>("commentDraft");

export const CommentDraft = Extension.create({
  name: "commentDraft",
  addProseMirrorPlugins() {
    return [
      new Plugin<Range>({
        key: commentDraftKey,
        state: {
          init: () => null,
          apply(tr, range) {
            const meta = tr.getMeta(commentDraftKey) as Range | undefined;
            if (meta !== undefined) return meta;
            if (!range || !tr.docChanged) return range;
            // Follow the words as others edit the text.
            const from = tr.mapping.map(range.from);
            const to = tr.mapping.map(range.to, -1);
            return to > from ? { from, to } : null;
          },
        },
        props: {
          decorations(state) {
            const range = commentDraftKey.getState(state);
            if (!range) return null;
            return DecorationSet.create(state.doc, [Decoration.inline(range.from, range.to, { class: "comment-draft" })]);
          },
        },
      }),
    ];
  },
});
