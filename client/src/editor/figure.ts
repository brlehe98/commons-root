import { Node, mergeAttributes } from "@tiptap/core";
import { t } from "../i18n";
import { NodeSelection, Plugin } from "@tiptap/pm/state";

export type ImageUrlResolver = (uri: string) => string;
let resolveImageUrl: ImageUrlResolver = (uri) => uri;
let fallbackImageUrl: ImageUrlResolver | null = null;
/** The address a photo is shown from, e.g. for a preview outside the text. */
export function figureImageUrl(uri: string): string {
  return resolveImageUrl(uri);
}

/** `fallback` is tried once when the first address fails to load. */
export function setImageUrlResolver(resolver: ImageUrlResolver, fallback?: ImageUrlResolver) {
  resolveImageUrl = resolver;
  fallbackImageUrl = fallback ?? null;
}

/**
 * When a photo does not load, try the fallback address, then say so on the
 * figure instead of leaving an empty grey frame.
 */
function onImageError(event: Event) {
  const img = event.target as HTMLImageElement;
  if (img.tagName !== "IMG" || !img.closest("figure")) return;
  const uri = img.getAttribute("data-uri") ?? "";
  if (fallbackImageUrl && !img.dataset.triedFallback) {
    img.dataset.triedFallback = "1";
    const next = fallbackImageUrl(uri);
    if (next && next !== img.src) {
      img.src = next;
      return;
    }
  }
  console.warn("photo did not load", uri, img.src);
  img.closest("figure")!.classList.add("figure-broken");
  img.closest("figure")!.setAttribute("data-error", t("editor.photoUnavailable"));
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    figure: { insertFigure: (uri: string) => ReturnType; replaceFigure: (uri: string) => ReturnType };
  }
}

/** A photo kept in Root's asset store, with an editable caption. */
export const Figure = Node.create({
  name: "figure",
  group: "block",
  content: "inline*",
  draggable: true,
  isolating: true,
  addAttributes: () => ({
    uri: {
      default: null,
      parseHTML: (el: HTMLElement) => el.querySelector("img")?.getAttribute("data-uri") ?? null,
      renderHTML: () => ({}),
    },
  }),
  parseHTML: () => [{ tag: "figure", contentElement: "figcaption" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "figure",
    mergeAttributes(HTMLAttributes, { class: "figure" }),
    ["img", { src: resolveImageUrl(node.attrs.uri), "data-uri": node.attrs.uri, alt: node.textContent, contenteditable: "false" }],
    ["figcaption", 0],
  ],
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          // A click on the photo selects the whole figure, not the caption.
          handleClickOn: (view, _pos, node, nodePos, event) => {
            if (node.type.name !== "figure" || (event.target as HTMLElement).tagName !== "IMG") return false;
            view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, nodePos)));
            return true;
          },
        },
        view(view) {
          // Image errors do not bubble, so listen while capturing.
          view.dom.addEventListener("error", onImageError, true);
          return { destroy: () => view.dom.removeEventListener("error", onImageError, true) };
        },
      }),
    ];
  },
  addCommands() {
    return {
      insertFigure:
        (uri) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { uri } }),
      replaceFigure:
        (uri) =>
        ({ commands }) =>
          commands.updateAttributes(this.name, { uri }),
    };
  },
});
