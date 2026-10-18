import type * as Y from "yjs";
// The sync code loads only when a project opens (the editor's tests leave it out).
import type { DocSync } from "../../sync";

/**
 * The workspace's own words (names, places, jargon), added from the spell
 * check and shared by its whole team. They live in a synced document,
 * "dictionary:<workspaceId>", as a map from the word in lowercase to the
 * word as added.
 */

/** Fired when the words change, so open texts are checked again. */
export const DICTIONARY_CHANGED = "spellcheck-dictionary-changed";

let sync: DocSync | null = null;
let openFor = "";
let canAdd = false;
const words = new Set<string>();

const map = (ydoc: Y.Doc) => ydoc.getMap<string>("words");

/** Opened by the open project, with whether its member may add words; "" closes it. */
export function openWorkspaceDictionary(workspaceId: string, mayAdd: boolean) {
  canAdd = mayAdd;
  if (workspaceId === openFor) return;
  sync?.destroy();
  sync = null;
  words.clear();
  openFor = workspaceId;
  if (!workspaceId) return;
  import("../../sync")
    .then(({ DocSync }) => {
      if (openFor !== workspaceId) return;
      const mine = new DocSync(`dictionary:${workspaceId}`);
      sync = mine;
      const refresh = () => {
        words.clear();
        map(mine.ydoc).forEach((_, key) => words.add(key));
        window.dispatchEvent(new Event(DICTIONARY_CHANGED));
      };
      map(mine.ydoc).observe(refresh);
      return mine.start().then(refresh);
    })
    .catch((err) => console.warn("Workspace dictionary unavailable", err));
}

/** True when the team added the word (any capitalization of it). */
export const isTeamWord = (word: string) => words.has(word.toLocaleLowerCase());

/** Whether this member may add words in the open workspace. */
export const canAddWords = () => !!sync && canAdd;

export function addTeamWord(word: string) {
  if (!sync || !canAdd) return;
  map(sync.ydoc).set(word.toLocaleLowerCase(), word);
}
