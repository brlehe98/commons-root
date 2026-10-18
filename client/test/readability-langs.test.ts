import { describe, expect, it } from "vitest";
import { countSyllables, detectLanguage, readability } from "../src/editor/readability";
import { setLocale } from "../src/i18n";

setLocale("en");

// A short news paragraph in each language, and a plain children's one.
const NEWS = {
  de: "Die Bundesregierung hat am Mittwoch ein umfangreiches Maßnahmenpaket zur Entlastung der Haushalte beschlossen. Die Opposition kritisiert die Finanzierung und verlangt eine unabhängige Überprüfung der wirtschaftlichen Auswirkungen.",
  es: "El gobierno aprobó el miércoles un amplio paquete de medidas para aliviar a los hogares. La oposición critica la financiación y exige una evaluación independiente de sus consecuencias económicas.",
  it: "Il governo ha approvato mercoledì un ampio pacchetto di misure per sostenere le famiglie. L'opposizione critica il finanziamento e chiede una valutazione indipendente delle conseguenze economiche.",
  pl: "Rząd przyjął w środę obszerny pakiet działań, który ma odciążyć gospodarstwa domowe. Opozycja krytykuje sposób finansowania i domaga się niezależnej oceny skutków gospodarczych.",
  pt: "O governo aprovou na quarta-feira um amplo pacote de medidas para aliviar as famílias. A oposição critica o financiamento e exige uma avaliação independente das consequências econômicas.",
  tr: "Hükümet çarşamba günü hanelerin yükünü hafifletmek için kapsamlı bir önlem paketi kabul etti. Muhalefet finansmanı eleştiriyor ve ekonomik etkilerin bağımsız olarak değerlendirilmesini istiyor.",
} as const;

const EASY = {
  de: "Der Hund ist klein. Er spielt im Gras. Die Sonne scheint. Wir gehen nach Hause. Es ist ein schöner Tag.",
  es: "El perro es pequeño. Juega en el parque. Hace sol. Vamos a casa. Es un buen día para todos.",
  it: "Il cane è piccolo. Gioca nel parco. C'è il sole. Andiamo a casa. È una bella giornata per tutti.",
  pl: "Pies jest mały. Bawi się w parku. Świeci słońce. Idziemy do domu. To jest dobry dzień dla nas.",
  pt: "O cão é pequeno. Ele brinca no parque. Faz sol. Vamos para casa. É um bom dia para todos.",
  tr: "Köpek küçük. Parkta oynuyor. Güneş var. Eve gidiyoruz. Bu güzel bir gün. Herkes mutlu ve biz de çok mutluyuz.",
} as const;

describe("the other six languages", () => {
  for (const language of Object.keys(NEWS) as (keyof typeof NEWS)[]) {
    it(`detects and grades ${language}`, () => {
      expect(detectLanguage(NEWS[language])).toBe(language);
      expect(detectLanguage(EASY[language])).toBe(language);
      const news = readability(NEWS[language])!;
      const easy = readability(EASY[language])!;
      expect(news.language).toBe(language);
      // A news story calls for secondary school or more; a children's text far less.
      expect(news.grade, `news ${news.grade}`).toBeGreaterThan(8);
      expect(news.grade, `news ${news.grade}`).toBeLessThan(20);
      expect(easy.grade, `easy ${easy.grade}`).toBeLessThan(7);
      expect(easy.grade).toBeLessThan(news.grade);
    });
  }

  it("still tells English and French apart", () => {
    expect(detectLanguage("The cat sat on the mat and we had fun in the sun all day.")).toBe("en");
    expect(detectLanguage("Le chat dort sur le lit. Il fait beau ce matin. Nous allons au parc avec les enfants.")).toBe("fr");
  });

  it("counts syllables the language's way", () => {
    const cases: [Parameters<typeof countSyllables>[1], string, number][] = [
      ["de", "Haus", 1], ["de", "Feier", 2], ["de", "Bundesregierung", 5],
      ["es", "queso", 2], ["es", "día", 2], ["es", "leer", 2], ["es", "ciudad", 2], ["es", "guitarra", 3],
      ["it", "chiesa", 2], ["it", "giorno", 2], ["it", "paese", 3], ["it", "famiglia", 3],
      ["pt", "coração", 3], ["pt", "família", 4], ["pt", "quero", 2],
      ["pl", "się", 1], ["pl", "wiadomość", 3], ["pl", "gospodarczych", 4],
      ["tr", "hükümet", 3], ["tr", "değerlendirilmesini", 8],
    ];
    for (const [language, word, n] of cases) expect(countSyllables(word, language), `${language} ${word}`).toBe(n);
  });
});
