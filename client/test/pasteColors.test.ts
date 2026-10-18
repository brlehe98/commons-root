// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { hexColor, isNeutralColor, pastedColor, stripPastedColors } from "../src/editor/pasteColors";
import { TEXT_COLORS } from "../src/editor/palette";

const RED = TEXT_COLORS[0].color;
const BLUE = TEXT_COLORS[3].color;
const GRAY = TEXT_COLORS[5].color;

describe("pasted text colors", () => {
  it("reads colors written the usual ways", () => {
    expect(hexColor("#C0392B")).toBe("#c0392b");
    expect(hexColor("#fff")).toBe("#ffffff");
    expect(hexColor("rgb(192, 57, 43)")).toBe("#c0392b");
    expect(hexColor("windowtext")).toBeNull();
  });

  it("tells base colors from chosen ones", () => {
    for (const c of ["#000", "#ffffff", "rgb(64, 64, 64)", "windowtext", "Black", "grey", "inherit"]) expect(isNeutralColor(c), c).toBe(true);
    for (const c of ["#ff0000", "#c0392b", "rgb(17, 85, 204)", "red", "darkgreen"]) expect(isNeutralColor(c), c).toBe(false);
  });

  it("drops base colors and keeps real ones as the palette's", () => {
    expect(pastedColor("#000000")).toBeNull();
    expect(pastedColor("rgb(255, 255, 255)")).toBeNull();
    expect(pastedColor("#595959")).toBeNull();
    expect(pastedColor("#FF0000")).toBe(RED);
    expect(pastedColor("rgb(17, 85, 204)")).toBe(BLUE);
    expect(pastedColor(RED)).toBe(RED);
    // The palette's gray is a color someone chose in the editor.
    expect(pastedColor(GRAY)).toBe(GRAY);
    expect(pastedColor("red")).toBe("red");
  });

  it("rewrites the pasted HTML", () => {
    const html = `<p><span style="color: rgb(0, 0, 0); font-weight: bold">noir</span> <span style="color: #ff0000">rouge</span> <font color="#1155cc">bleu</font> <span style="color: #595959">gris</span></p>`;
    const out = stripPastedColors(html);
    expect(out).not.toMatch(/rgb\(0, 0, 0\)|#595959|rgb\(89, 89, 89\)/i);
    expect(out).toContain("font-weight: bold");
    const colors = [...out.matchAll(/color: ([^;"]+)/g)].map((m) => hexColor(m[1]));
    expect(colors).toEqual([RED, BLUE]);
  });
});
