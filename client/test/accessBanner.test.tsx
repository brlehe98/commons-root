// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AccessLevel } from "@commons-root/gen-shared";
import AccessBanner from "../src/ui/AccessBanner";
import { setLocale } from "../src/i18n";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function render(level: AccessLevel): string {
  const el = document.createElement("div");
  act(() => createRoot(el).render(<AccessBanner level={level} />));
  return el.textContent ?? "";
}

describe("access banner", () => {
  setLocale("fr");

  it("says nothing to editors and admins", () => {
    expect(render(AccessLevel.EDIT)).toBe("");
    expect(render(AccessLevel.ADMIN)).toBe("");
  });

  it("tells readers and suggesters what they can do", () => {
    expect(render(AccessLevel.READ)).toBe("Lecture seule");
    const suggest = render(AccessLevel.COMMENT);
    expect(suggest).toBe("Suggestions ou commentaires seulement");
  });
});
