import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { TEXT_COLORS } from "./palette";

/** "#C0392B", "#c39", "rgb(192, 57, 43)" → "#c0392b"; null when not a plain color. */
export function hexColor(value: string): string | null {
  const v = value.trim().toLowerCase();
  const short = v.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) return `#${rgb.slice(1, 4).map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("")}`;
  return null;
}

// Names of greys and of "the text's color" that a copy can carry.
const NEUTRAL_NAMES = /^(black|white|silver|gainsboro|whitesmoke|(dim|dark|light|slate|lightslate|darkslate)?gr[ae]y|windowtext|canvastext|inherit|initial|unset|currentcolor|auto|transparent|var\(.*)$/;

const rgbOf = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/**
 * A base text color rather than a chosen one: black, white or a grey (its
 * red, green and blue barely differ), or a name for the text's own color.
 */
export function isNeutralColor(value: string): boolean {
  const hex = hexColor(value);
  if (!hex) return NEUTRAL_NAMES.test(value.trim().toLowerCase());
  const [r, g, b] = rgbOf(hex);
  return Math.max(r, g, b) - Math.min(r, g, b) < 40;
}

/** Hue of "#rrggbb", 0–360. */
function hue(hex: string): number {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (!d) return 0;
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
}

const PALETTE = new Set(TEXT_COLORS.map((c) => hexColor(c.color)!));
// The palette's colored entries (its gray is a neutral).
const HUED = [...PALETTE].filter((hex) => !isNeutralColor(hex));

/**
 * What a pasted color becomes: null for black, white and greys, which give
 * way to the text's own color; the palette color closest in hue for a real
 * color (a red word stays red, in a shade that also reads in dark mode).
 * The palette's own colors, and names the code cannot place, stay as they are.
 */
export function pastedColor(value: string): string | null {
  const hex = hexColor(value);
  if (hex && PALETTE.has(hex)) return hex;
  if (isNeutralColor(value)) return null;
  if (!hex) return value.trim();
  const distance = (other: string) => {
    const d = Math.abs(hue(other) - hue(hex));
    return Math.min(d, 360 - d);
  };
  return HUED.reduce((best, c) => (distance(c) < distance(best) ? c : best));
}

/**
 * Pasted text takes the text's own color: the black of a Word document or the
 * white of a dark page is dropped. A real color is kept, as the palette's.
 */
export function stripPastedColors(html: string): string {
  if (!html.includes("color")) return html;
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.body.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (!el.style.color) return;
    const color = pastedColor(el.style.color);
    if (color) el.style.color = color;
    else el.style.removeProperty("color");
  });
  // Old-style <font color>: the editor reads colors from styles only.
  doc.body.querySelectorAll<HTMLElement>("font[color]").forEach((el) => {
    const color = pastedColor(el.getAttribute("color") ?? "");
    el.removeAttribute("color");
    if (color) el.style.color = color;
  });
  return doc.body.innerHTML;
}

export const PasteColors = Extension.create({
  name: "pasteColors",
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey("pasteColors"), props: { transformPastedHTML: stripPastedColors } })];
  },
});
