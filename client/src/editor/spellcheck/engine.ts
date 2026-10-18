import type { Language as TextLanguage } from "../readability";
import { t } from "../../i18n";
import { isTeamWord } from "./dictionary";

/** A problem found in a piece of text, with offsets in that text. */
export type Issue = {
  from: number;
  to: number;
  message: string;
  suggestions: string[];
  /** Suggestions computed on demand, when the popup opens. */
  more?: () => Promise<string[]>;
  /** The unknown word, for a spelling issue: it can be added to the dictionary. */
  word?: string;
};

export type Checker = (text: string, language: TextLanguage) => Promise<Issue[]>;

// ---- Spelling, every language: Hunspell with LibreOffice's dictionaries, in a worker. ----

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, (data: { wrong?: string[]; suggestions?: string[]; error?: string }) => void>();

function ask<T>(message: object): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL("./hunspellWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event) => {
      const resolve = pending.get(event.data.id);
      pending.delete(event.data.id);
      resolve?.(event.data);
    };
  }
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, (data) => (data.error ? reject(new Error(data.error)) : resolve(data as T)));
    worker!.postMessage({ id, ...message });
  });
}

// A word with its elisions and hyphens: l'école, aujourd'hui, peut-être, don't.
const WORD = /\p{L}[\p{L}'’-]*\p{L}|\p{L}/gu;

async function checkSpelling(text: string, language: TextLanguage): Promise<Issue[]> {
  const found: { from: number; to: number; word: string }[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = match[0].replace(/’/g, "'");
    // Single letters and acronyms (CAQ, ONU, NATO), even after an elision
    // (l'ONU, d'IRIS), are not worth flagging.
    const last = word.slice(word.lastIndexOf("'") + 1);
    if (word.length < 2 || word === word.toUpperCase() || (last.length > 1 && last === last.toUpperCase())) continue;
    found.push({ from: match.index!, to: match.index! + match[0].length, word });
  }
  if (!found.length) return [];
  const { wrong } = await ask<{ wrong: string[] }>({ kind: "check", language, words: Array.from(new Set(found.map((f) => f.word))) });
  const bad = new Set(wrong);
  return found
    .filter((f) => bad.has(f.word) && !isTeamWord(f.word))
    .map((f) => ({
      from: f.from,
      to: f.to,
      message: t("spell.unknown"),
      suggestions: [],
      word: f.word,
      more: () => ask<{ suggestions: string[] }>({ kind: "suggest", language, word: f.word }).then((r) => r.suggestions),
    }));
}

// ---- English grammar: Harper, loaded on first use. Its spelling lints are
// left out (Hunspell checks spelling the same way in every language), and so
// are its American-only remarks: Canadian spellings are welcome. ----

type HarperLinter = { setup(): Promise<void>; lint(text: string): Promise<HarperLint[]> };
type HarperLint = {
  span(): { start: number; end: number };
  message(): string;
  lint_kind(): string;
  suggestions(): { get_replacement_text(): string }[];
};

let harper: Promise<HarperLinter> | null = null;
let harperReady: HarperLinter | null = null;

/** Fired once grammar can be checked, so texts checked before get another pass. */
export const GRAMMAR_READY = "spellcheck-grammar-ready";

function loadHarper(): Promise<HarperLinter> {
  harper ??= (async () => {
    const [{ WorkerLinter, LocalLinter }, { binary }] = await Promise.all([import("harper.js"), import("harper.js/binary")]);
    try {
      const linter = new WorkerLinter({ binary }) as unknown as HarperLinter;
      await linter.setup();
      return linter;
    } catch (err) {
      // A host that refuses workers still gets the checker, on the main thread.
      console.warn("Harper worker unavailable, checking on the main thread", err);
      const linter = new LocalLinter({ binary }) as unknown as HarperLinter;
      await linter.setup();
      return linter;
    }
  })();
  return harper;
}

// Grammar never holds up spelling: until Harper has loaded (it is large),
// English texts get spelling only, then a second pass.
async function checkEnglishGrammar(text: string): Promise<Issue[]> {
  if (!harperReady) {
    loadHarper()
      .then((linter) => {
        if (harperReady) return;
        harperReady = linter;
        window.dispatchEvent(new Event(GRAMMAR_READY));
      })
      .catch((err) => console.warn("Grammar check unavailable", err));
    return [];
  }
  const linter = harperReady;
  return (await linter.lint(text))
    .filter((lint) => lint.lint_kind() !== "Spelling" && lint.lint_kind() !== "Regionalism")
    .map((lint) => {
      const span = lint.span();
      return {
        from: span.start,
        to: span.end,
        message: lint.message(),
        suggestions: lint.suggestions().map((s) => s.get_replacement_text()).slice(0, 5),
      };
    });
}

/** Checks a paragraph in its language: spelling everywhere, plus grammar in English. */
export const checkText: Checker = async (text, language) => {
  if (language !== "en") return checkSpelling(text, language);
  const [spelling, grammar] = await Promise.all([checkSpelling(text, language), checkEnglishGrammar(text).catch(() => [])]);
  // A word Hunspell flags is not underlined twice.
  return [...spelling, ...grammar.filter((g) => !spelling.some((s) => g.from < s.to && s.from < g.to))];
};
