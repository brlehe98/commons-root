import { Node, mergeAttributes } from "@tiptap/core";

let resolveFileUrl: (uri: string) => string = (uri) => uri;
/** The address an attached file opens from. */
export function setFileUrlResolver(resolver: (uri: string) => string) {
  resolveFileUrl = resolver;
}
export const fileUrl = (uri: string) => resolveFileUrl(uri);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: { insertAttachment: (attrs: { uri: string; name: string }) => ReturnType };
  }
}

/** A file kept in Root's asset store (a PDF, a sheet…), shown as a link to open it. */
export const Attachment = Node.create({
  name: "attachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes: () => ({
    uri: { default: null, parseHTML: (el: HTMLElement) => el.getAttribute("data-uri") },
    name: { default: "", parseHTML: (el: HTMLElement) => el.getAttribute("data-name") ?? "" },
  }),
  parseHTML: () => [{ tag: "div[data-attachment]" }],
  renderHTML: ({ node, HTMLAttributes }) => [
    "div",
    mergeAttributes(HTMLAttributes, { "data-attachment": "", class: "attachment", "data-uri": node.attrs.uri, "data-name": node.attrs.name }),
    ["a", { href: resolveFileUrl(node.attrs.uri), target: "_blank", rel: "noopener noreferrer", contenteditable: "false" }, node.attrs.name || "File"],
  ],
  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
