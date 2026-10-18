import { Extension } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { suggestChangesKey } from "@handlewithcare/prosemirror-suggest-changes";
import { detectLanguage, type Language as TextLanguage } from "../readability";
import { checkText, GRAMMAR_READY, type Checker, type Issue } from "./engine";
import { addTeamWord, canAddWords, DICTIONARY_CHANGED } from "./dictionary";
import "./spellcheck.css";
import { t } from "../../i18n";

/** A text block as plain text, with the document position of each character. */
export type Block = { text: string; positions: number[] };

/**
 * Paragraphs, headings and captions as text. Text a suggestion deletes is
 * blanked out (it is on its way out), and other inline nodes count as a space.
 */
export function textBlocks(doc: PMNode): Block[] {
  const blocks: Block[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = "";
    const positions: number[] = [];
    node.forEach((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText) {
        const deleted = child.marks.some((m) => m.type.name === "deletion");
        for (let i = 0; i < child.text!.length; i++) {
          text += deleted ? " " : child.text![i];
          positions.push(start + i);
        }
      } else {
        text += " ";
        positions.push(start);
      }
    });
    if (text.trim()) blocks.push({ text, positions });
    return false;
  });
  return blocks;
}

type Found = Issue & { pos: { from: number; to: number } };
// language: the text's language when chosen on its tab; null detects it.
type State = { decorations: DecorationSet; issues: Found[]; language: TextLanguage | null };

export const spellcheckKey = new PluginKey<State>("spellcheck");

const DELAY_MS = 900;
const IGNORED = new Set<string>();

function decorate(doc: PMNode, issues: Found[]): DecorationSet {
  return DecorationSet.create(
    doc,
    issues.map((i) => Decoration.inline(i.pos.from, i.pos.to, { class: "spell-error", title: i.message }, { issue: i })),
  );
}

/** Runs the checker over every block, reusing results for unchanged text. */
export async function findIssues(doc: PMNode, check: Checker, cache: Map<string, Issue[]>, language?: TextLanguage | null): Promise<Found[]> {
  const blocks = textBlocks(doc);
  const lang = language ?? detectLanguage(blocks.map((b) => b.text).join("\n"));
  const found: Found[] = [];
  for (const block of blocks) {
    const key = `${lang}:${block.text}`;
    let issues = cache.get(key);
    if (!issues) {
      issues = await check(block.text, lang);
      cache.set(key, issues);
    }
    for (const issue of issues) {
      const problem = block.text.slice(issue.from, issue.to);
      if (issue.to <= issue.from || !problem.trim() || IGNORED.has(problem.toLowerCase())) continue;
      found.push({ ...issue, pos: { from: block.positions[issue.from], to: block.positions[issue.to - 1] + 1 } });
    }
  }
  return found;
}

class Popup {
  private el: HTMLDivElement | null = null;
  private cleanup?: () => void;

  constructor(private view: EditorView) {}

  open(issue: Found) {
    this.close();
    const el = document.createElement("div");
    el.className = "spell-popup";
    el.setAttribute("role", "dialog");
    const message = document.createElement("p");
    message.textContent = issue.message;
    el.appendChild(message);
    const list = document.createElement("div");
    list.className = "spell-suggestions";
    el.appendChild(list);
    const ignore = document.createElement("button");
    ignore.type = "button";
    ignore.className = "spell-ignore";
    ignore.textContent = t("spell.ignore");
    ignore.onclick = () => {
      IGNORED.add(this.view.state.doc.textBetween(issue.pos.from, issue.pos.to).toLowerCase());
      this.close();
      this.view.dispatch(this.view.state.tr.setMeta(spellcheckKey, { refresh: true }));
    };
    el.appendChild(ignore);
    const word = issue.word;
    if (word && canAddWords()) {
      const add = document.createElement("button");
      add.type = "button";
      add.className = "spell-ignore spell-add";
      add.textContent = t("spell.add");
      add.title = t("spell.addTitle", { word });
      add.onclick = () => {
        addTeamWord(word);
        this.close();
      };
      el.appendChild(add);
    }

    // Fixed to the window, under the word, kept on screen.
    const coords = this.view.coordsAtPos(issue.pos.from);
    el.style.left = `${Math.max(8, Math.min(coords.left, window.innerWidth - 316))}px`;
    el.style.top = `${coords.bottom + 4}px`;
    document.body.appendChild(el);
    this.el = el;
    // A click anywhere else, or scrolling, closes it.
    const away = (e: Event) => {
      if (!el.contains(e.target as Node)) this.close();
    };
    window.setTimeout(() => {
      document.addEventListener("mousedown", away, true);
      document.addEventListener("scroll", away, true);
    });
    this.cleanup = () => {
      document.removeEventListener("mousedown", away, true);
      document.removeEventListener("scroll", away, true);
    };

    const show = (suggestions: string[]) => {
      list.replaceChildren();
      if (!suggestions.length) list.textContent = t("editor.noSuggestion");
      for (const s of suggestions) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = s || "(remove)";
        button.onmousedown = (e) => e.preventDefault();
        button.onclick = () => {
          const { from, to } = issue.pos;
          const tr = this.view.state.tr;
          if (s) tr.insertText(s, from, to);
          else tr.delete(from, to);
          this.view.dispatch(tr);
          this.close();
          this.view.focus();
        };
        list.appendChild(button);
      }
    };
    show(issue.suggestions);
    if (!issue.suggestions.length && issue.more) {
      list.textContent = "…";
      issue.more().then((s) => this.el === el && show(s)).catch(() => this.el === el && show([]));
    }
  }

  close() {
    this.cleanup?.();
    this.cleanup = undefined;
    this.el?.remove();
    this.el = null;
  }
}

/**
 * Underlines spelling mistakes in the text's language (Root's eight) and
 * grammar ones in English;
 * a click shows suggestions. Everything runs in the browser.
 */
export const SpellCheck = Extension.create<{ check: Checker }>({
  name: "spellcheck",

  addOptions() {
    return { check: checkText };
  },

  addProseMirrorPlugins() {
    const check = this.options.check;
    let popup: Popup | null = null;
    return [
      new Plugin<State>({
        key: spellcheckKey,
        state: {
          init: () => ({ decorations: DecorationSet.empty, issues: [], language: null }),
          apply(tr, value): State {
            const meta = tr.getMeta(spellcheckKey) as { issues?: Found[]; refresh?: boolean; language?: TextLanguage | null } | undefined;
            if (meta && "language" in meta) return { ...value, language: meta.language ?? null };
            if (meta?.issues) return { ...value, issues: meta.issues, decorations: decorate(tr.doc, meta.issues) };
            if (meta?.refresh) {
              const issues = value.issues.filter((i) => !IGNORED.has(tr.doc.textBetween(i.pos.from, i.pos.to).toLowerCase()));
              return { ...value, issues, decorations: decorate(tr.doc, issues) };
            }
            if (!tr.docChanged) return value;
            // Keep underlines in place while typing; a fresh check follows.
            const decorations = value.decorations.map(tr.mapping, tr.doc);
            const issues = decorations.find().map((d) => ({ ...(d.spec.issue as Found), pos: { from: d.from, to: d.to } }));
            return { ...value, decorations, issues };
          },
        },
        props: {
          decorations: (state: EditorState) => spellcheckKey.getState(state)?.decorations,
          handleClick(view, pos) {
            const issue = spellcheckKey.getState(view.state)?.issues.find((i) => pos >= i.pos.from && pos <= i.pos.to);
            if (issue && view.editable) popup?.open(issue);
            else popup?.close();
            return false;
          },
          handleKeyDown(_view, event) {
            if (event.key === "Escape") popup?.close();
            return false;
          },
        },
        view(view) {
          popup = new Popup(view);
          const cache = new Map<string, Issue[]>();
          let timer: number | undefined;
          let run = 0;
          const schedule = () => {
            window.clearTimeout(timer);
            timer = window.setTimeout(async () => {
              if (!view.editable) return;
              const mine = ++run;
              const doc = view.state.doc;
              try {
                const issues = await findIssues(doc, check, cache, spellcheckKey.getState(view.state)?.language);
                // Drop results for a text that changed meanwhile.
                if (mine !== run || view.isDestroyed || !view.state.doc.eq(doc)) return;
                view.dispatch(view.state.tr.setMeta(spellcheckKey, { issues }).setMeta(suggestChangesKey, { skip: true }).setMeta("addToHistory", false));
              } catch (err) {
                console.warn("Spell check failed", err);
              }
            }, DELAY_MS);
          };
          schedule();
          // English grammar arrives after spelling: check again without the old results.
          const recheck = () => {
            cache.clear();
            schedule();
          };
          window.addEventListener(GRAMMAR_READY, recheck);
          // A word added by anyone on the team stops being underlined everywhere.
          window.addEventListener(DICTIONARY_CHANGED, recheck);
          return {
            update(view, prev) {
              const languageChanged = spellcheckKey.getState(view.state)?.language !== spellcheckKey.getState(prev)?.language;
              if (view.state.doc !== prev.doc || languageChanged) schedule();
            },
            destroy() {
              window.removeEventListener(GRAMMAR_READY, recheck);
              window.removeEventListener(DICTIONARY_CHANGED, recheck);
              window.clearTimeout(timer);
              popup?.close();
              popup = null;
            },
          };
        },
      }),
    ];
  },
});

/** Checks the text as `language` (chosen on its tab), or detects it when null. */
export function setTextLanguage(view: EditorView, language: TextLanguage | null) {
  if (spellcheckKey.getState(view.state)?.language === language) return;
  view.dispatch(view.state.tr.setMeta(spellcheckKey, { language }).setMeta(suggestChangesKey, { skip: true }).setMeta("addToHistory", false));
}
