import { describe, expect, it } from "vitest";
import { countSyllables, readability } from "../src/editor/readability";
import { setLocale } from "../src/i18n";

// Labels are checked in English, whatever the machine's language.
setLocale("en");

describe("syllables", () => {
  it("counts English words", () => {
    for (const [w, n] of [["cat", 1], ["table", 2], ["named", 1], ["wanted", 2], ["reading", 2], ["beautiful", 3], ["journalism", 4]] as const)
      expect(countSyllables(w, "en"), w).toBe(n);
  });
  it("counts French words", () => {
    for (const [w, n] of [["chat", 1], ["table", 1], ["maison", 2], ["journaliste", 3], ["écrivent", 2], ["éducation", 4], ["rédaction", 3], ["réaction", 3], ["poète", 2], ["naïf", 2], ["créer", 2]] as const)
      expect(countSyllables(w, "fr"), w).toBe(n);
  });
});

describe("scores", () => {
  it("rates simple English as easy and dense English as difficult", () => {
    const easy = readability("The cat sat on the mat. The dog ran to the park. We had fun in the sun all day.", "en")!;
    const hard = readability(
      "Notwithstanding considerable institutional resistance, the municipal administration implemented comprehensive infrastructural modernization initiatives throughout the metropolitan jurisdiction.",
      "en",
    )!;
    expect(easy.score).toBeGreaterThan(90);
    expect(hard.score).toBeLessThan(10);
    expect(hard.label).toBe("Very difficult");
  });

  it("uses Kandel and Moles for French", () => {
    const text = "Le chat dort sur le lit. Il fait beau ce matin. Nous allons au parc avec les enfants.";
    const r = readability(text, "fr")!;
    // 207 - 1.015 * (words / sentences) - 73.6 * (syllables / words)
    const expected = 207 - 1.015 * (r.words / r.sentences) - 73.6 * (r.syllables / r.words);
    expect(r.score).toBe(Math.round(expected));
    expect(r.score).toBeGreaterThan(80);
  });

  it("needs a minimum of text", () => {
    expect(readability("Too short.", "en")).toBeNull();
  });
});

describe("school level", async () => {
  const { gradeLevel } = await import("../src/editor/readability");
  it("reads grades as Quebec levels for French and Canadian grades for English", () => {
    expect(gradeLevel(5.2, "fr")).toBe("Primaire 5");
    expect(gradeLevel(9.6, "fr")).toBe("Secondaire 3");
    expect(gradeLevel(9.2, "fr")).toBe("Secondaire 3");
    expect(gradeLevel(12.4, "fr")).toBe("Cégep");
    expect(gradeLevel(15, "fr")).toBe("Université");
    expect(gradeLevel(9.6, "en")).toBe("Grade 9");
    expect(gradeLevel(14, "en")).toBe("College or university");
  });

  it("gives a newsroom text a secondary-school grade, as Antidote does", () => {
    // About 19 words per sentence, as in a typical news story.
    const text = Array.from(
      { length: 6 },
      () =>
        "Pendant la campagne électorale, tous les partis prétendent défendre la classe moyenne, son pouvoir d’achat et sa qualité de vie.",
    ).join(" ");
    const r = readability(text, "fr")!;
    expect(r.grade).toBeGreaterThan(8);
    expect(r.grade).toBeLessThan(13);
    expect(r.level).toMatch(/^Secondaire|Cégep/);
  });

  it("measures paragraphs and the longest sentence and paragraph", () => {
    const text = ["Un titre", "Une phrase courte. Une phrase un peu plus longue que la première.", "Un autre paragraphe tout simple ici."].join("\n");
    const r = readability(text, "fr")!;
    expect(r.longestSentence.words).toBe(9);
    expect(r.longestSentence.start).toMatch(/^Une phrase un peu plus longue/);
    expect(r.longestParagraph.words).toBe(12);
    expect(r.paragraphWords).toBe(Math.round(r.words / 3));
  });
});

describe("language and difficulty", async () => {
  const { detectLanguage, difficulty } = await import("../src/editor/readability");
  it("detects French and English from the text", () => {
    expect(detectLanguage("Pendant la campagne électorale, tous les partis prétendent défendre la classe moyenne.")).toBe("fr");
    expect(detectLanguage("During the campaign, all the parties claim to defend the middle class and their quality of life.")).toBe("en");
  });
  it("reads without being told the language", () => {
    const r = readability("Le chat dort sur le lit. Il fait beau ce matin. Nous allons au parc avec les enfants.")!;
    expect(r.language).toBe("fr");
    expect(r.level).toMatch(/^Primaire|Secondaire/);
  });
  it("names the difficulty of a grade", () => {
    expect(difficulty(4.2)).toBe("Very easy");
    expect(difficulty(9.9)).toBe("Hard");
    expect(difficulty(13)).toBe("Very hard");
  });
});
