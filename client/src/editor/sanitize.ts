// The preview comes from the editor's own serializer, so it only holds the
// schema's tags; this pass is a second line of defense before it is shown as
// HTML: no active elements, no event handlers, links only to web or mail.
const BLOCKED_TAGS = "script, iframe, object, embed, style, link, meta, base, form, input, button, textarea, svg, math";
const SAFE_LINK = /^(https?:|mailto:|#)/i;
export function sanitizePreview(root: HTMLElement) {
  root.querySelectorAll(BLOCKED_TAGS).forEach((node) => node.remove());
  root.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcdoc" || name === "formaction") node.removeAttribute(attr.name);
      else if ((name === "href" || name === "src" || name === "xlink:href") && !SAFE_LINK.test(attr.value.trim())) node.removeAttribute(attr.name);
    }
  });
}
