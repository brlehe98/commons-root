// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { LOCALES, pickLocale, setLocale, t } from "../src/i18n";
import { en } from "../src/i18n/en";
import { de } from "../src/i18n/de";
import { es } from "../src/i18n/es";
import { fr } from "../src/i18n/fr";
import { it as itCatalog } from "../src/i18n/it";
import { pl } from "../src/i18n/pl";
import { pt } from "../src/i18n/pt";
import { tr } from "../src/i18n/tr";

const CATALOGS: Record<string, Record<string, unknown>> = { de, es, fr, it: itCatalog, pl, pt, tr };
const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const forms = (entry: unknown): string[] => (typeof entry === "string" ? [entry] : Object.values(entry as Record<string, string>));

describe("interface language", () => {
  afterEach(() => setLocale("en"));

  it("follows the reader's first language we translate, keeping their region", () => {
    expect(pickLocale(["fr-CA", "en"])).toEqual({ catalog: "fr", tag: "fr-CA" });
    expect(pickLocale(["xx-YY", "fr"])).toEqual({ catalog: "fr", tag: "fr" });
    expect(pickLocale(["xx"])).toEqual({ catalog: "en", tag: "en" });
  });

  it("fills placeholders and picks plural forms", () => {
    expect(t("due.inDays", { count: 1 })).toBe("In 1 day");
    expect(t("due.inDays", { count: 3 })).toBe("In 3 days");
    setLocale("fr-CA");
    expect(t("due.inDays", { count: 3 })).toBe("Dans 3 jours");
    expect(t("search.count", { count: 2 })).toBe("2 résultats");
    expect(document.documentElement.lang).toBe("fr-CA");
  });

  it("reads Root's languages, Brazilian Portuguese included", () => {
    expect(pickLocale(["pt-BR"])).toEqual({ catalog: "pt", tag: "pt-BR" });
    setLocale("pl");
    expect(t("due.inDays", { count: 5 })).toBe("Za 5 dni");
    expect(t("due.inDays", { count: 3 })).toBe("Za 3 dni");
    expect(t("editor.words", { count: 22 })).toBe("22 słowa");
  });

  it("registers every catalog", () => {
    expect(LOCALES.sort()).toEqual(["en", ...Object.keys(CATALOGS)].sort());
  });

  for (const [tag, catalog] of Object.entries(CATALOGS)) {
    it(`${tag}: has every text, with the same placeholders as English`, () => {
      for (const [key, entry] of Object.entries(en)) {
        expect(catalog[key], key).toBeDefined();
        const wanted = new Set(forms(entry).flatMap(placeholders));
        for (const form of forms(catalog[key])) {
          for (const name of placeholders(form)) expect(wanted.has(name), `${tag} ${key}: {${name}}`).toBe(true);
        }
      }
    });
  }
});
