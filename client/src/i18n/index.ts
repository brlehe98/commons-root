import { en, type Messages } from "./en";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";
import { it } from "./it";
import { pl } from "./pl";
import { pt } from "./pt";
import { tr } from "./tr";

/**
 * The interface language. Root's SDK does not give the app the user's
 * language yet, so it follows the device's (the web view reports it); the
 * day Root exposes its own setting, `pickLocale` takes it instead.
 */

// Each translation lists only what it has; anything missing shows in English.
// Root's eight languages (Portuguese is Brazil's).
const catalogs: Record<string, Partial<Messages>> = { de, en, es, fr, it, pl, pt, tr };

// Right-to-left scripts.
const RTL = new Set(["ar", "he", "fa", "ur"]);

/**
 * The first of the reader's languages we have a catalog for, or English.
 * `catalog` is the translation used; `tag` keeps the reader's region
 * ("fr-CA") so dates and numbers are written their way.
 */
export function pickLocale(preferred: readonly string[] = globalThis.navigator?.languages ?? []): { catalog: string; tag: string } {
  for (const tag of preferred) {
    if (!tag) continue;
    const base = tag.toLowerCase().split("-")[0];
    if (catalogs[base]) return { catalog: base, tag };
  }
  return { catalog: "en", tag: "en" };
}

let current = pickLocale();
let messages: Partial<Messages> = catalogs[current.catalog];

/** The language in use, as a BCP 47 tag for `Intl` (dates, numbers). */
export const locale = () => current.tag;

/** For tests and the day the language comes from Root. */
export function setLocale(tag: string) {
  current = pickLocale([tag]);
  messages = catalogs[current.catalog];
  applyToDocument();
}

/** The languages the interface is translated into. */
export const LOCALES = Object.keys(catalogs);

type Key = keyof Messages;
type Params = Record<string, string | number>;

/**
 * The text for `key` in the reader's language. `{name}` placeholders take
 * `params`; a text with plural forms ({ one, other, … }) picks its form from
 * `params.count`.
 */
export function t(key: Key, params?: Params): string {
  const entry = messages[key] ?? en[key];
  let text: string;
  if (typeof entry === "string") text = entry;
  else {
    const count = Number(params?.count ?? 0);
    const form = new Intl.PluralRules(current.tag).select(count) as keyof typeof entry;
    text = entry[form] ?? entry.other;
  }
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/** Sets the page's language and direction so the browser lays text out right. */
export function applyToDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = current.tag;
  document.documentElement.dir = RTL.has(current.catalog) ? "rtl" : "ltr";
}

/** Between names in a list: ", " in most languages. */
export const listSeparator = () => t("common.listSeparator");
