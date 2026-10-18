import { locale, t } from "../i18n";

/** The languages of Root's client, which texts are measured in. */
export const LANGUAGES = ["en", "fr", "de", "es", "it", "pl", "pt", "tr"] as const;
export type Language = (typeof LANGUAGES)[number];

/** "German", "allemand": the language's name in the reader's language. */
export function languageName(language: Language): string {
  try {
    return new Intl.DisplayNames([locale()], { type: "language" }).of(language) ?? language;
  } catch {
    return language;
  }
}

export type Part = { words: number; start: string };

export type Readability = {
  /**
   * Reading ease on the language's own scale: Flesch (English), Kandel &
   * Moles (French), Amstad (German), Szigriszt-Pazos (Spanish), Gulpease
   * (Italian), Martins (Portuguese), Ateşman (Turkish). Polish has no ease
   * formula in use; its score is the Flesch equivalent of its grade.
   */
  score: number;
  label: string;
  /**
   * Years of schooling needed, e.g. 9.6. Flesch–Kincaid for English and
   * French (as Antidote shows it), the Wiener Sachtextformel for German,
   * Pisarek for Polish, and the ease score read on its own scale's school
   * levels for the other languages.
   */
  grade: number;
  /** School level that reads it comfortably: Quebec for French, Canada for English. */
  level: string;
  /** How hard the grade is: "Very easy" … "Very hard". */
  difficulty: string;
  /** The language the text was read as (detected when not given). */
  language: Language;
  words: number;
  sentences: number;
  syllables: number;
  /** Average words per paragraph (a heading counts as a paragraph). */
  paragraphWords: number;
  longestSentence: Part;
  longestParagraph: Part;
};

const BANDS: [number, Parameters<typeof t>[0]][] = [
  [90, "read.veryEasy"],
  [80, "read.easy"],
  [70, "read.fairlyEasy"],
  [60, "read.standard"],
  [50, "read.fairlyDifficult"],
  [30, "read.difficult"],
  [-Infinity, "read.veryDifficult"],
];

/**
 * The school level for a grade such as 9.6: Quebec levels for French
 * (Primaire 1–6, Secondaire 1–5, Cégep, Université), Canadian grades for
 * English.
 */
export function gradeLevel(grade: number, language: Language): string {
  const year = Math.max(1, Math.floor(grade));
  if (language === "fr") {
    if (year <= 6) return `Primaire ${year}`;
    if (year <= 11) return `Secondaire ${year - 6}`;
    return year <= 13 ? "Cégep" : "Université";
  }
  if (year <= 12) return t("read.grade", { n: year });
  return year <= 16 ? t("read.college") : t("read.graduate");
}

/** How hard a grade reads, from primary school to university. */
export function difficulty(grade: number): string {
  if (grade < 6) return t("read.veryEasy");
  if (grade < 8) return t("read.easy");
  if (grade < 9) return t("read.standard");
  if (grade < 12) return t("read.hard");
  return t("read.veryHard");
}

// Short words that are common in one language and rare in the others.
// Words shared by several of them ("de", "la", "que", "un", "con", "in"…)
// are left out: they would not tell the languages apart.
const STOPWORDS: Record<Language, Set<string>> = {
  en: words("the and of to is that for it with as be this by at from have has had not but or which their they you we will would there been were"),
  fr: words("les des du et est une pour qui dans sur pas au aux ce cette ces avec elle nous vous ils elles sont été être sa ses leur leurs plus comme tout aussi très"),
  de: words("der die das und ist nicht ein eine einen dem den mit sich auf für von zu auch im wird werden wurde sind hat haben noch nach bei aus wie oder aber wenn dass wir ich"),
  es: words("el los las y es muy pero sus ya más también hay donde ella estos fue han sin cuando hasta su"),
  it: words("di che è sono nel nella dei delle alla anche più questo questa hanno stato degli dello per gli"),
  pl: words("w z nie się że jest jak ale co po od za tak jego już przez tylko jej są dla może być czy oraz który która"),
  pt: words("os do das em na nas um uma é não seu sua ao foi são também já ele isso pelo pela muito"),
  tr: words("bir ve bu için ile çok gibi daha olarak olan sonra kadar ama var değil her şey ben biz olduğu ancak"),
};

// Letters only one of the languages uses.
const MARKERS: [Language, RegExp][] = [
  ["es", /[ñ¿¡]/giu],
  ["pt", /[ãõ]/giu],
  ["pl", /[łśżźćńąę]/giu],
  ["de", /[ßä]/giu],
  ["tr", /[ıİğş]/gu],
  ["fr", /[œîû]/giu],
];

function words(list: string): Set<string> {
  return new Set(list.split(" "));
}

/** The language of the text, from the common words and the letters it uses. */
export function detectLanguage(text: string): Language {
  const counts = Object.fromEntries(LANGUAGES.map((l) => [l, 0])) as Record<Language, number>;
  for (const w of text.toLowerCase().match(/[\p{L}']+/gu) ?? []) {
    for (const l of LANGUAGES) if (STOPWORDS[l].has(w)) counts[l]++;
  }
  for (const [l, re] of MARKERS) counts[l] += (text.match(re) ?? []).length;
  let best: Language = "en";
  for (const l of LANGUAGES) if (counts[l] > counts[best]) best = l;
  // Nothing to go on: accented letters tip it toward French, as before.
  if (counts[best] === 0 && /[éèêàçùô]/i.test(text)) return "fr";
  return best;
}

const WORD = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;

export function countSyllables(word: string, language: Language): number {
  let w = word.toLowerCase().replace(/[^\p{L}]/gu, "");
  if (!w) return 0;
  if (language !== "en" && language !== "fr") return SYLLABLES[language](w);
  if (language === "en") {
    if (w.length <= 3) return 1;
    // Silent endings: "make", "named", "takes", but not "table" or "wanted".
    w = w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
    const groups = w.match(/[aeiouy]+/g);
    // "-ism", "prism": the final "sm" carries its own syllable.
    return Math.max(1, (groups?.length ?? 1) + (/sm$/.test(w) ? 1 : 0));
  }
  // French: two vowels in hiatus are two syllables: "ré-ac-tion", "po-è-te",
  // "na-ïf", "cré-er".
  w = w.replace(/([éèêë])(?=[aeiouyàâäéèêëîïôöùûü])/g, "$1|").replace(/([aeiouyàâ])(?=[éèêëïü])/g, "$1|");
  // The final mute e (and -es, -ent of verbs) is not pronounced.
  w = w.replace(/(?<=[^aeiouyàâäéèêëîïôöùûüœæ])(?:e|es|ent)$/, "");
  const groups = w.match(/[aeiouyàâäéèêëîïôöùûüœæ]+/g);
  return Math.max(1, groups?.length ?? 1);
}

const count = (w: string, vowels: RegExp) => Math.max(1, w.match(vowels)?.length ?? 1);

/**
 * Syllables in the other languages: one per vowel group, with each
 * language's diphthongs kept whole and its hiatuses split.
 */
const SYLLABLES: Record<Exclude<Language, "en" | "fr">, (w: string) => number> = {
  // "Haus", "Straße": ei, ai, au, eu, äu, ie and doubled vowels are one
  // sound, so a vowel group is a syllable; an e after a diphthong starts the
  // next one ("Fei-er", "Bau-er").
  de: (w) => count(w.replace(/(ei|ai|au|eu|äu)(?=e)/g, "$1|"), /[aeiouyäöü]+/g),
  // Strong vowels (a, e, o) next to each other are two syllables ("le-er",
  // "ca-o-s"); a weak one (i, u) joins its neighbour unless accented
  // ("dí-a"). The u of que, qui, gue, gui is silent.
  es: (w) => count(splitHiatus(w.replace(/(?<=[qg])u(?=[eéií])/g, ""), "aeoáéó", "íú"), /[aeiouáéíóúü]+/g),
  // As in Spanish; the i of cia, gio, scia only softens the consonant.
  it: (w) => count(splitHiatus(w.replace(/(?<=[qg])u(?=[aeiou])/g, "").replace(/(?<=c|g|sc)i(?=[aou])/g, ""), "aeoàèéò", "ìíù"), /[aeiouàèéìíòóù]+/g),
  // As in Spanish; ão, ãe, õe are one nasal sound, and a final -ia, -io
  // is two syllables, as Portuguese grammar splits it ("fa-mí-li-a").
  pt: (w) => count(splitHiatus(w.replace(/(?<=[qg])u(?=[eéêií])/g, "").replace(/([ãõ])[eo]/g, "$1").replace(/(?<=[^aeiou])i(?=[aeo]s?$)/, "i|"), "aeoáéóâêôãõ", "íú"), /[aeiouáéíóúâêôãõü]+/g),
  // Every vowel is a syllable, except an i before a vowel, which only
  // softens the consonant: "nie", "się", "wiadomość".
  pl: (w) => count(w.replace(/i(?=[aąeęioóuy])/g, ""), /[aąeęioóuy]/g),
  // Turkish has no diphthongs: one vowel, one syllable.
  tr: (w) => count(w, /[aeıioöuü]/g),
};

/** Marks syllable breaks between strong vowels, and around an accented weak one. */
function splitHiatus(w: string, strong: string, accentedWeak: string): string {
  const s = `[${strong}]`;
  const a = `[${accentedWeak}]`;
  return w
    .replace(new RegExp(`(${s})(?=${s})`, "g"), "$1|")
    // A weak vowel between two strong ones opens the second syllable: "pa-u-ra".
    .replace(new RegExp(`(${s})(?=[iu]${s})`, "g"), "$1|")
    .replace(new RegExp(`(?<=[^|])(${a})`, "g"), "|$1")
    .replace(new RegExp(`(${a})(?=.)`, "g"), "$1|");
}

const wordCount = (part: string) => (part.match(WORD) ?? []).length;

/** The longest part by words, with how it begins. */
function longest(parts: string[]): Part {
  let best: Part = { words: 0, start: "" };
  for (const p of parts) {
    const n = wordCount(p);
    if (n > best.words) {
      const t = p.trim().replace(/\s+/g, " ");
      best = { words: n, start: t.length > 70 ? `${t.slice(0, 70)}…` : t };
    }
  }
  return best;
}

type Counts = {
  words: number;
  sentences: number;
  syllables: number;
  letters: number;
  /** Words of more than 6 letters. */
  longWords: number;
  oneSyllable: number;
  threePlus: number;
  fourPlus: number;
};

/** Flesch–Kincaid: years of schooling, from sentence and word length. */
const kincaid = (c: Counts) => 0.39 * (c.words / c.sentences) + 11.8 * (c.syllables / c.words) - 15.59;

/**
 * Flesch's own reading of his scale: 90 and up is grade 5, 80 grade 6,
 * 70 grade 7, 60 grades 8–9, 50 grades 10–12, 30 college, below graduate.
 */
const FLESCH_GRADES: [number, number][] = [[100, 4], [90, 5], [80, 6], [70, 7], [60, 8.5], [50, 11], [30, 14.5], [0, 18]];
// Gulpease's: below 80 is hard after primary school (5 years), below 60
// after middle school (8), below 40 after high school (13).
const GULPEASE_GRADES: [number, number][] = [[100, 2], [80, 5], [60, 8], [40, 13], [20, 17], [0, 19]];

/** Reads a point on a scale (descending ease, ascending grade) between its marks. */
function interpolate(points: [number, number][], x: number, from: 0 | 1): number {
  const to = from === 0 ? 1 : 0;
  const [first, last] = [points[0], points[points.length - 1]];
  const descending = first[from] > last[from];
  if (descending ? x >= first[from] : x <= first[from]) return first[to];
  if (descending ? x <= last[from] : x >= last[from]) return last[to];
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    if (descending ? x >= b[from] : x <= b[from]) return a[to] + ((x - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
  }
  return last[to];
}

const gradeForEase = (ease: number, scale = FLESCH_GRADES) => interpolate(scale, ease, 0);
const easeForGrade = (grade: number) => Math.round(interpolate(FLESCH_GRADES, grade, 1));

/** The language's own ease score and the school years it calls for. */
function measure(language: Language, c: Counts): { score: number; grade: number } {
  const perSentence = c.words / c.sentences;
  const perWord = c.syllables / c.words;
  const percent = (n: number) => (100 * n) / c.words;
  switch (language) {
    case "en":
      return { score: 206.835 - 1.015 * perSentence - 84.6 * perWord, grade: kincaid(c) };
    case "fr":
      // Kandel & Moles: Flesch with French syllables weighed less.
      return { score: 207 - 1.015 * perSentence - 73.6 * perWord, grade: kincaid(c) };
    case "de":
      // Amstad's ease; the first Wiener Sachtextformel (Bamberger & Vanecek)
      // gives the German school grade, 4 to 15.
      return {
        score: 180 - perSentence - 58.5 * perWord,
        grade: 0.1935 * percent(c.threePlus) + 0.1672 * perSentence + 0.1297 * percent(c.longWords) - 0.0327 * percent(c.oneSyllable) - 0.875,
      };
    case "es": {
      // Szigriszt-Pazos (the INFLESZ scale).
      const score = 206.835 - 62.3 * perWord - perSentence;
      return { score, grade: gradeForEase(score) };
    }
    case "pt": {
      // Martins et al.'s Flesch for Brazilian Portuguese.
      const score = 248.835 - 1.015 * perSentence - 84.6 * perWord;
      return { score, grade: gradeForEase(score) };
    }
    case "tr": {
      // Ateşman's Flesch for Turkish.
      const score = 198.825 - 40.175 * perWord - 2.61 * perSentence;
      return { score, grade: gradeForEase(score) };
    }
    case "it": {
      // Gulpease counts letters, not syllables: Italian's standard measure.
      const score = 89 + (300 * c.sentences - 10 * c.letters) / c.words;
      return { score, grade: gradeForEase(score, GULPEASE_GRADES) };
    }
    case "pl":
      // Pisarek's formula, as Jasnopis uses it: the result is the school
      // year, from sentence length and the share of words of 4+ syllables.
      return { score: 0, grade: Math.sqrt(perSentence ** 2 + percent(c.fourPlus) ** 2) / 2 };
  }
}

export function readability(text: string, given?: Language): Readability | null {
  const words = text.match(WORD) ?? [];
  if (words.length < 10) return null;
  const language = given ?? detectLanguage(text);
  // A sentence ends at . ! ? … or at the end of a paragraph or heading
  // (headings have no final period), as Antidote counts them.
  const sentenceParts = text.split(/(?<=[.!?…])\s+|\n+/).filter((part) => HAS_WORD.test(part));
  const sentences = Math.max(1, sentenceParts.length);
  const paragraphs = text.split(/\n+/).filter((part) => HAS_WORD.test(part));
  const perWord = words.map((w) => countSyllables(w, language));
  const syllables = perWord.reduce((n, k) => n + k, 0);
  const measured = measure(language, {
    words: words.length,
    sentences,
    syllables,
    letters: words.reduce((n, w) => n + (w.match(/\p{L}/gu)?.length ?? 0), 0),
    longWords: words.filter((w) => (w.match(/\p{L}/gu)?.length ?? 0) > 6).length,
    oneSyllable: perWord.filter((k) => k === 1).length,
    threePlus: perWord.filter((k) => k >= 3).length,
    fourPlus: perWord.filter((k) => k >= 4).length,
  });
  const rounded = Math.round(measured.score);
  const grade = Math.max(0, Math.round(measured.grade * 10) / 10);
  // The label reads on Flesch's scale, which Gulpease and Polish are not on.
  const flesch = language === "it" || language === "pl" ? easeForGrade(grade) : rounded;
  return {
    score: language === "pl" ? flesch : rounded,
    label: t(BANDS.find(([min]) => flesch >= min)![1]),
    grade,
    level: gradeLevel(grade, language),
    difficulty: difficulty(grade),
    language,
    words: words.length,
    sentences,
    syllables,
    paragraphWords: Math.round(words.length / Math.max(1, paragraphs.length)),
    longestSentence: longest(sentenceParts),
    longestParagraph: longest(paragraphs),
  };
}
