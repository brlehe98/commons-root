/**
 * Highlight and text colors. `color` is what the text stores (and what Word
 * gets); `dark` is how it shows in dark mode, where the text is white:
 * deeper highlights, lighter text colors.
 */
import { t } from "../i18n";

export type PaletteColor = { color: string; dark: string; label: string };

export const HIGHLIGHTS: PaletteColor[] = [
  { color: "#ffd60a", dark: "#8f6d00", label: t("color.yellow") },
  { color: "#5ee07a", dark: "#1d7a37", label: t("color.green") },
  { color: "#6cb8ff", dark: "#1e5ea8", label: t("color.blue") },
  { color: "#ff7eb6", dark: "#a32b63", label: t("color.pink") },
  { color: "#ff9f40", dark: "#a8520c", label: t("color.orange") },
];

export const TEXT_COLORS: PaletteColor[] = [
  { color: "#c0392b", dark: "#ff7b6b", label: t("color.red") },
  { color: "#d35400", dark: "#ffa45c", label: t("color.orange") },
  { color: "#1e8449", dark: "#5fd38a", label: t("color.green") },
  { color: "#1f5fbf", dark: "#7fb4ff", label: t("color.blue") },
  { color: "#7d3c98", dark: "#c79bf2", label: t("color.purple") },
  { color: "#6b7280", dark: "#a7a7a8", label: t("color.gray") },
];

export const isDarkTheme = () => document.documentElement.dataset.theme === "dark";

/** Dark mode swaps each stored color for its dark version, in the text and in comments. */
function paletteCss(): string {
  const dark = ':root[data-theme="dark"]';
  return [
    ...HIGHLIGHTS.map((h) => `${dark} .tiptap mark[data-color="${h.color}" i] { background-color: ${h.dark} !important; color: #fff !important; }`),
    ...TEXT_COLORS.map((c) => `${dark} .tiptap span[style*="${c.color}" i] { color: ${c.dark} !important; }`),
  ].join("\n");
}

if (typeof document !== "undefined" && !document.getElementById("editor-palette")) {
  const style = document.createElement("style");
  style.id = "editor-palette";
  style.textContent = paletteCss();
  document.head.append(style);
}
