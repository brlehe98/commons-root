import { Extension } from "@tiptap/core";
import { keymap } from "@tiptap/pm/keymap";
import * as Y from "yjs";
import { ySyncPlugin, ySyncPluginKey, yUndoPlugin, undo, redo } from "y-prosemirror";
import type { DocSync } from "../sync";

/**
 * One undo history per document, created here rather than by yUndoPlugin.
 * yUndoPlugin destroys its UndoManager whenever the editor view is torn down,
 * and React remounts the view (StrictMode, EditorContent), which silently
 * broke Ctrl+Z. This one is only destroyed with the document.
 */
const undoManagers = new WeakMap<Y.XmlFragment, Y.UndoManager>();
function undoManagerFor(fragment: Y.XmlFragment): Y.UndoManager {
  let manager = undoManagers.get(fragment);
  if (!manager) {
    manager = new Y.UndoManager(fragment, {
      trackedOrigins: new Set([ySyncPluginKey]),
      captureTransaction: (tr) => tr.meta.get("addToHistory") !== false,
    });
    const destroy = manager.destroy.bind(manager);
    manager.destroy = () => undefined;
    fragment.doc?.once("destroy", destroy);
    undoManagers.set(fragment, manager);
  }
  return manager;
}

// y-prosemirror is patched (patches/y-prosemirror+1.3.7.patch) so marks on
// block nodes sync. Without it, structural suggestions look accepted to others.
export const Collaboration = Extension.create<{ sync: DocSync | null }>({
  name: "collaboration",
  priority: 1000,
  addOptions: () => ({ sync: null }),
  addProseMirrorPlugins() {
    const sync = this.options.sync!;
    const fragment = sync.ydoc.getXmlFragment("body");
    return [
      ySyncPlugin(fragment),
      yUndoPlugin({ undoManager: undoManagerFor(fragment) }),
      keymap({ "Mod-z": undo, "Mod-y": redo, "Mod-Shift-z": redo }),
    ];
  },
});

export { undo, redo };
