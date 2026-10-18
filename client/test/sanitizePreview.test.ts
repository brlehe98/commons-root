// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { sanitizePreview } from "../src/editor/sanitize";

describe("version preview sanitizer", () => {
  it("drops active elements, handlers and unsafe links, keeps text and safe links", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p onclick="alert(1)">Hello <a href="javascript:alert(1)">bad</a> <a href="https://example.org">good</a></p>' +
      '<script>alert(1)</script><iframe src="https://x"></iframe><img src="data:x" onerror="alert(1)"><svg onload="alert(1)"></svg>';
    sanitizePreview(root);
    expect(root.querySelector("script, iframe, svg")).toBeNull();
    expect(root.querySelector("p")!.hasAttribute("onclick")).toBe(false);
    const links = root.querySelectorAll("a");
    expect(links[0].hasAttribute("href")).toBe(false);
    expect(links[1].getAttribute("href")).toBe("https://example.org");
    expect(root.querySelector("img")!.hasAttribute("onerror")).toBe(false);
    expect(root.querySelector("img")!.hasAttribute("src")).toBe(false);
    expect(root.textContent).toContain("Hello");
  });
});
