import { Node, mergeAttributes } from "@tiptap/core";

let resolveFileUrl: (uri: string) => string = (uri) => uri;
/** The address an attached file opens from. */
export function setFileUrlResolver(resolver: (uri: string) => string) {
  resolveFileUrl = resolver;
}
/** Only files stored in Root open: any other address in a document is ignored. */
export const fileUrl = (uri: string) => (/^root:\/\/[^\s"'<>\\]+$/.test(uri) ? resolveFileUrl(uri) : "");
/** A PDF shows in the page itself, under its name. */
export const isPdf = (name: string) => /\.pdf$/i.test(name.trim());

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    attachment: { insertAttachment: (attrs: { uri: string; name: string }) => ReturnType };
  }
}

/** A file kept in Root's asset store (a PDF, a sheet…), shown as a link to open it; a PDF also shows in the page. */
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
  renderHTML: ({ node, HTMLAttributes }) => {
    const url = fileUrl(String(node.attrs.uri ?? ""));
    const name = String(node.attrs.name ?? "");
    const link = ["a", { href: url || null, target: "_blank", rel: "noopener noreferrer", contenteditable: "false" }, name || "File"];
    return [
      "div",
      mergeAttributes(HTMLAttributes, { "data-attachment": "", class: "attachment", "data-uri": node.attrs.uri, "data-name": name }),
      link,
      ...(url && isPdf(name) ? [["iframe", { class: "pdf-view", src: url, title: name, loading: "lazy", referrerpolicy: "no-referrer", contenteditable: "false" }]] : []),
    ];
  },
  addCommands() {
    return {
      insertAttachment:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
