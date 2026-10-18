import { describe, expect, it } from "vitest";
import { searchIcons } from "../src/fields/iconSearch";

describe("icon search", () => {
  it("offers every Lucide icon without a query", () => {
    expect(searchIcons("").length).toBeGreaterThan(1500);
  });
  it("finds icons by name first, then by keyword", () => {
    expect(searchIcons("newspaper")[0]).toBe("Newspaper");
    expect(searchIcons("translate")).toContain("Languages");
  });
  it("understands common French words", () => {
    expect(searchIcons("journal")).toContain("Newspaper");
    expect(searchIcons("Météo").length).toBeGreaterThan(3);
  });
});
