/// <reference lib="webworker" />
// Spelling with Hunspell, the checker LibreOffice uses, and LibreOffice's
// dictionaries, in a worker so the editor never waits. Each language loads
// on first use (a fraction of a second, a few MB).
import { Hunspell } from "hunspell-wasm";
import initializer from "hunspell-wasm/wasm/hunspell.js";
import wasmUrl from "hunspell-wasm/wasm/hunspell.wasm?url";
import deAff from "@dictionary-de/index.aff?url";
import deDic from "@dictionary-de/index.dic?url";
import enAff from "@dictionary-en/index.aff?url";
import enDic from "@dictionary-en/index.dic?url";
import enCaDic from "@dictionary-en-ca/index.dic?url";
import esAff from "@dictionary-es/index.aff?url";
import esDic from "@dictionary-es/index.dic?url";
import frAff from "@dictionary-fr/index.aff?url";
import frDic from "@dictionary-fr/index.dic?url";
import itAff from "@dictionary-it/index.aff?url";
import itDic from "@dictionary-it/index.dic?url";
import plAff from "@dictionary-pl/index.aff?url";
import plDic from "@dictionary-pl/index.dic?url";
import ptAff from "@dictionary-pt/index.aff?url";
import ptDic from "@dictionary-pt/index.dic?url";
import trAff from "@dictionary-tr/index.aff?url";
import trDic from "@dictionary-tr/index.dic?url";
import type { Language as TextLanguage } from "../readability";

// English takes both American and Canadian spellings (color and colour).
const FILES: Record<TextLanguage, { aff: string; dic: string; extra?: string }> = {
  de: { aff: deAff, dic: deDic },
  en: { aff: enAff, dic: enDic, extra: enCaDic },
  es: { aff: esAff, dic: esDic },
  fr: { aff: frAff, dic: frDic },
  it: { aff: itAff, dic: itDic },
  pl: { aff: plAff, dic: plDic },
  pt: { aff: ptAff, dic: ptDic },
  tr: { aff: trAff, dic: trDic },
};

const text = (url: string) => fetch(url).then((r) => r.text());
// The engine, once; told where Vite put its .wasm file.
let engine: Promise<unknown> | null = null;
// (Emscripten takes options; the package types leave them out.)
const initHunspell = initializer as unknown as (options: { locateFile: () => string }) => Promise<unknown>;
const loadEngine = () => (engine ??= initHunspell({ locateFile: () => wasmUrl }));
const loaded = new Map<TextLanguage, Promise<Hunspell>>();

function dictionary(language: TextLanguage): Promise<Hunspell> {
  let ready = loaded.get(language);
  if (!ready) {
    const files = FILES[language];
    ready = (async () => {
      const [aff, dic, extra] = await Promise.all([text(files.aff), text(files.dic), files.extra ? text(files.extra) : Promise.resolve("")]);
      const hunspell = new Hunspell(await loadEngine(), aff, dic);
      if (extra) hunspell.addDictionaryFromString(extra);
      return hunspell;
    })();
    loaded.set(language, ready);
  }
  return ready;
}

type Request =
  | { id: number; kind: "check"; language: TextLanguage; words: string[] }
  | { id: number; kind: "suggest"; language: TextLanguage; word: string };

self.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  try {
    const hunspell = await dictionary(message.language);
    if (message.kind === "check") {
      self.postMessage({ id: message.id, wrong: message.words.filter((w) => !hunspell.testSpelling(w)) });
    } else {
      self.postMessage({ id: message.id, suggestions: hunspell.getSpellingSuggestions(message.word).slice(0, 5) });
    }
  } catch (err) {
    self.postMessage({ id: message.id, error: String((err as Error)?.message ?? err) });
  }
};
