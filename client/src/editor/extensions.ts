import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import { Insertion, Deletion, Modification, SuggestChanges, SUGGESTION_MARKS } from "./suggestions";
import { Collaboration } from "./collaboration";
import { Figure } from "./figure";
import { Footnote } from "./footnote";
import { Attachment } from "./attachment";
import TextAlign from "@tiptap/extension-text-align";
import Blockquote from "@tiptap/extension-blockquote";
import Highlight from "@tiptap/extension-highlight";
import { Color, TextStyle } from "@tiptap/extension-text-style";
import { Indent } from "./indent";
import { Surtitle } from "./surtitle";
import { CommentMark } from "./comments";
import { CommentDraft } from "./commentDraft";
import { PasteColors } from "./pasteColors";
import { SpellCheck } from "./spellcheck/plugin";
import type { DocSync } from "../sync";

/** The schema every text shares: the draft, its publication and its history. */
function baseExtensions() {
  return [
    StarterKit.configure({
      document: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      undoRedo: false,
      code: false,
      codeBlock: false,
      blockquote: false,
      heading: { levels: [1, 2, 3, 4] },
      link: { openOnClick: false, autolink: true },
    }),
    // Containers of blocks must allow suggestion marks on their children.
    Document.extend({ marks: SUGGESTION_MARKS }),
    BulletList.extend({ marks: SUGGESTION_MARKS }),
    OrderedList.extend({ marks: SUGGESTION_MARKS }),
    ListItem.extend({ marks: SUGGESTION_MARKS }),
    Blockquote.extend({ marks: SUGGESTION_MARKS }),
    Highlight.configure({ multicolor: true }),
    TextStyle,
    Color,
    PasteColors,
    Figure,
    Footnote,
    Attachment,
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Indent,
    Surtitle,
  ];
}

/** `spellcheck`: underline mistakes (the app turns it on; tests leave it off). */
export function buildExtensions(sync: DocSync, userId: string, { spellcheck = false } = {}) {
  return [
    ...baseExtensions(),
    Insertion,
    Deletion,
    Modification,
    CommentMark,
    CommentDraft,
    SuggestChanges.configure({ userId }),
    Collaboration.configure({ sync }),
    ...(spellcheck ? [SpellCheck] : []),
  ];
}

/** A published page: the same nodes, read-only, without comments or suggestions. */
export function buildReadExtensions() {
  // The block containers name the suggestion marks, so the schema needs them.
  return [...baseExtensions(), Insertion, Deletion, Modification];
}
