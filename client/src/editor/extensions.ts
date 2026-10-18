import StarterKit from "@tiptap/starter-kit";
import Document from "@tiptap/extension-document";
import { BulletList, OrderedList, ListItem } from "@tiptap/extension-list";
import { Insertion, Deletion, Modification, SuggestChanges, SUGGESTION_MARKS } from "./suggestions";
import { Collaboration } from "./collaboration";
import { Figure } from "./figure";
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

/** `spellcheck`: underline mistakes (the app turns it on; tests leave it off). */
export function buildExtensions(sync: DocSync, userId: string, { spellcheck = false } = {}) {
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
    TextAlign.configure({ types: ["heading", "paragraph"], alignments: ["left", "center", "right", "justify"] }),
    Indent,
    Surtitle,
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
