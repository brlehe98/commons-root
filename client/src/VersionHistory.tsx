import { sanitizePreview } from "./editor/sanitize";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { DOMSerializer } from "@tiptap/pm/model";
import { historyServiceClient } from "@commons-root/gen-client";
import { AccessLevel, Version } from "@commons-root/gen-shared";
import { blockTexts, cleanDoc, diffTexts, restoreVersion, versionDoc } from "./editor/history";
import { loadNames } from "./users";
import "./history.css";
import { locale, t } from "./i18n";
import { confirmDialog } from "./ui/dialog";
import { tNodes } from "./i18n/nodes";
import UserName from "./ui/UserName";
import { ArrowLeft } from "lucide-react";

type Props = {
  docId: string;
  editor: Editor;
  level: AccessLevel;
  onClose: () => void;
};

// "current" stands for the live text.
type Pick = bigint | "current";

const states = new Map<bigint, Uint8Array>();

async function fetchState(id: bigint): Promise<Uint8Array> {
  const cached = states.get(id);
  if (cached) return cached;
  const first = await historyServiceClient.getVersion({ id, transferId: "", chunk: 0 });
  const parts = [first.state];
  for (let i = 1; i < first.totalChunks; i++)
    parts.push((await historyServiceClient.getVersion({ id, transferId: first.transferId, chunk: i })).state);
  const whole = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    whole.set(p, offset);
    offset += p.length;
  }
  states.set(id, whole);
  return whole;
}

function when(v: Version): string {
  return new Date(Number(v.createdAt)).toLocaleString(locale(), { dateStyle: "medium", timeStyle: "short" });
}

function label(v: Version): string {
  return v.name || t("history.auto");
}

export default function VersionHistory({ docId, editor, level, onClose }: Props) {
  const canEdit = level >= AccessLevel.EDIT;
  const [versions, setVersions] = useState<Version[]>([]);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<bigint | null>(null);
  const [compareTo, setCompareTo] = useState<Pick | null>(null);
  const [docs, setDocs] = useState<Map<bigint, PMNode>>(new Map());
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<bigint | null>(null);
  const [, setNamesLoaded] = useState(0);

  const load = useCallback(
    async (beforeId = 0n) => {
      try {
        const res = await historyServiceClient.listVersions({ docId, beforeId });
        setVersions((list) => (beforeId ? [...list, ...res.versions] : res.versions));
        setMore(res.more);
        await loadNames(res.versions.map((v) => v.authorId).filter(Boolean));
        setNamesLoaded((n) => n + 1);
      } catch (err) {
        setError(String((err as Error).message ?? err));
      }
    },
    [docId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const docOf = useCallback(
    async (id: bigint) => {
      if (docs.has(id)) return docs.get(id)!;
      const doc = versionDoc(await fetchState(id), editor.schema);
      setDocs((m) => new Map(m).set(id, doc));
      return doc;
    },
    [docs, editor],
  );

  useEffect(() => {
    if (selected !== null) docOf(selected).catch((err) => setError(String(err.message ?? err)));
    if (typeof compareTo === "bigint") docOf(compareTo).catch((err) => setError(String(err.message ?? err)));
  }, [selected, compareTo, docOf]);

  const selectedDoc = selected !== null ? docs.get(selected) : undefined;
  const otherDoc = compareTo === "current" ? editor.state.doc : typeof compareTo === "bigint" ? docs.get(compareTo) : undefined;

  const preview = useMemo(() => {
    if (!selectedDoc) return "";
    // Built in a separate, inert document so no image starts loading.
    const inert = document.implementation.createHTMLDocument("");
    const el = inert.createElement("div");
    el.appendChild(DOMSerializer.fromSchema(editor.schema).serializeFragment(selectedDoc.content, { document: inert }));
    // Photos are shown by the editor's node view; a preview keeps captions only.
    el.querySelectorAll("img").forEach((img) => img.replaceWith(Object.assign(inert.createElement("span"), { className: "photo-placeholder", textContent: t("history.photo") })));
    sanitizePreview(el);
    return el.innerHTML;
  }, [selectedDoc, editor]);

  const diff = useMemo(() => {
    if (!selectedDoc || !otherDoc) return null;
    // Older on the left, so additions read as what changed since.
    const selectedVersion = versions.find((v) => v.id === selected);
    const otherVersion = typeof compareTo === "bigint" ? versions.find((v) => v.id === compareTo) : undefined;
    const otherIsNewer = compareTo === "current" || (otherVersion && selectedVersion && otherVersion.id > selectedVersion.id);
    const [before, after] = otherIsNewer ? [selectedDoc, otherDoc] : [otherDoc, selectedDoc];
    return diffTexts(blockTexts(cleanDoc(before)), blockTexts(cleanDoc(after)));
  }, [selectedDoc, otherDoc, selected, compareTo, versions]);

  async function save() {
    try {
      const res = await historyServiceClient.saveVersion({ docId, name: newName.trim() || t("history.named") });
      setNewName("");
      if (res.version) setVersions((list) => [res.version!, ...list]);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  }

  async function rename(v: Version, name: string) {
    setRenaming(null);
    if (name.trim() === v.name) return;
    try {
      await historyServiceClient.renameVersion({ id: v.id, name });
      setVersions((list) => list.map((x) => (x.id === v.id ? { ...x, name: name.trim() } : x)));
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  }

  async function restore() {
    if (selected === null) return;
    const v = versions.find((x) => x.id === selected)!;
    if (!(await confirmDialog(t("history.confirmRestore", { name: label(v), date: when(v) }), { ok: t("history.restore") }))) return;
    try {
      const backup = await historyServiceClient.saveVersion({ docId, name: t("history.beforeRestoring", { name: label(v) }) });
      restoreVersion(editor.view, await docOf(selected));
      if (backup.version) setVersions((list) => [backup.version!, ...list]);
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  }

  const selectedVersion = versions.find((v) => v.id === selected);

  return (
    <div className={selectedVersion ? "history picked" : "history"}>
      <aside className="history-list">
        <div className="history-head">
          <h2>{t("editor.history")}</h2>
          <button className="history-close" onClick={onClose} aria-label={t("history.close")}>
            ×
          </button>
        </div>
        {canEdit && (
          <form
            className="history-save"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <input placeholder={t("history.namePlaceholder")} value={newName} maxLength={80} onChange={(e) => setNewName(e.target.value)} />
            <button type="submit">{t("history.save")}</button>
          </form>
        )}
        {error && <p className="history-error">{error}</p>}
        {!versions.length && !error && (
          <p className="hint">{t("history.none")}</p>
        )}
        <ul>
          {versions.map((v) => (
            <li key={String(v.id)} className={v.id === selected ? "active" : ""} onClick={() => setSelected(v.id)}>
              {renaming === v.id ? (
                <input
                  autoFocus
                  defaultValue={v.name}
                  maxLength={80}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => rename(v, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    if (e.key === "Escape") setRenaming(null);
                  }}
                />
              ) : (
                <span
                  className={v.name ? "history-name" : "history-name auto"}
                  onDoubleClick={() => canEdit && setRenaming(v.id)}
                  title={canEdit ? t("history.rename") : undefined}
                >
                  {label(v)}
                </span>
              )}
              <span className="hint">
                {when(v)}
                {v.authorId && (
                  <>
                    {" · "}
                    <UserName id={v.authorId} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
        {more && (
          <button className="history-more" onClick={() => load(versions[versions.length - 1].id)}>
            {t("history.older")}
          </button>
        )}
      </aside>

      <section className="history-view">
        {!selectedVersion ? (
          <p className="hint">{t("history.pick")}</p>
        ) : (
          <>
            <div className="history-toolbar">
              <button className="icon history-back" onClick={() => setSelected(null)} title={t("editor.history")} aria-label={t("editor.history")}>
                <ArrowLeft size={18} />
              </button>
              <strong>{label(selectedVersion)}</strong>
              <label>
                {t("history.compare")}{" "}
                <select
                  value={compareTo === null ? "" : String(compareTo)}
                  onChange={(e) => {
                    const value = e.target.value;
                    setCompareTo(value === "" ? null : value === "current" ? "current" : BigInt(value));
                  }}
                >
                  <option value="">{t("history.nothing")}</option>
                  <option value="current">{t("history.current")}</option>
                  {versions
                    .filter((v) => v.id !== selected)
                    .map((v) => (
                      <option key={String(v.id)} value={String(v.id)}>
                        {label(v)}, {when(v)}
                      </option>
                    ))}
                </select>
              </label>
              {canEdit && (
                <button className="history-restore" onClick={restore} disabled={!selectedDoc}>
                  {t("history.restore")}
                </button>
              )}
            </div>
            {!selectedDoc ? (
              <p className="hint">{t("app.loading")}</p>
            ) : diff ? (
              <div className="history-diff">
                <p className="hint">
                  {tNodes("history.diffHint", { added: <ins>{t("history.added")}</ins>, removed: <del>{t("history.removed")}</del> })}
                </p>
                {diff.map((part, i) =>
                  part.kind === "added" ? <ins key={i}>{part.text}</ins> : part.kind === "removed" ? <del key={i}>{part.text}</del> : <span key={i}>{part.text}</span>,
                )}
              </div>
            ) : (
              <div className="history-preview tiptap" dangerouslySetInnerHTML={{ __html: preview }} />
            )}
          </>
        )}
      </section>
    </div>
  );
}
