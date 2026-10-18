import React, { useEffect, useState } from "react";
import { rootClient } from "@rootsdk/client-app";
import { AccessLevel } from "@commons-root/gen-shared";
import { DocSync, SyncStatus } from "./sync";
import { cachedName, colorForUser, loadNames } from "./users";
import ArticleEditor from "./ArticleEditor";
import { isRateLimitError } from "./rateLimit";
import { t } from "./i18n";
import { forget, recall, remember } from "./snapshots";
import { useBusy } from "./ui/busy";

import type { Language } from "./editor/readability";

// emptyText: shown instead of a blank page when a read-only text is empty.
type Props = {
  docId: string;
  level: AccessLevel;
  compact?: boolean;
  /** The text's language when chosen on its tab (null: detected), and how to change it. */
  language?: Language | null;
  onLanguageChange?: (language: Language | null) => void;
  variant?: "field" | "reader" | "doc";
  emptyText?: string;
};

/** Opens a shared document and mounts the editor once its content arrived. */
const DocEditor: React.FC<Props> = ({ docId, level, compact, language, onLanguageChange, variant, emptyText }) => {
  const userId = rootClient.users.getCurrentUserId();
  const [sync, setSync] = useState<DocSync | null>(null);
  const [status, setStatus] = useState<SyncStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  // Bumped to reopen the text from the server after refused edits.
  const [reload, setReload] = useState(0);
  const [refused, setRefused] = useState<string | null>(null);

  useEffect(() => {
    const s = new DocSync(docId);
    const key = `doc:${docId}`;
    s.onStatus = setStatus;
    s.onRefused = (message) => {
      if (cancelled) return;
      // The saved copy may hold the refused edits: start again from the server.
      forget(key);
      setRefused(message);
      setReload((n) => n + 1);
    };
    let cancelled = false;
    setError(null);
    // The last copy seen opens the text at once; the server's follows.
    // Only a copy with content: an empty one would let the editor add its
    // starting paragraph before the real text arrives.
    const saved = reload ? undefined : recall<Uint8Array>(key);
    if (saved) s.seed(saved);
    setStatus(s.status);
    s.awareness.setLocalStateField("user", { id: userId, name: cachedName(userId), color: colorForUser(userId) });
    setSync(saved && s.ydoc.getXmlFragment("body").length ? s : null);
    const save = () => s.loaded && remember(key, s.state());
    const onHide = () => document.visibilityState === "hidden" && save();
    document.addEventListener("visibilitychange", onHide);
    (async () => {
      // Root may still refuse a burst of requests; wait and try again
      // rather than leaving the text closed.
      for (let attempt = 1; ; attempt++) {
        try {
          await loadNames([userId]);
          s.awareness.setLocalStateField("user", { id: userId, name: cachedName(userId), color: colorForUser(userId) });
          // Wait for the server copy before mounting the editor, otherwise its
          // empty starting paragraph would be merged into the shared document.
          await s.start();
          break;
        } catch (err) {
          if (cancelled || !isRateLimitError(err) || attempt >= 4) throw err;
          await new Promise((r) => window.setTimeout(r, 1500 * attempt));
        }
      }
      if (!cancelled) setSync(s);
    })().catch((err) => !cancelled && setError(String(err?.message ?? err)));
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onHide);
      save();
      s.destroy();
    };
  }, [docId, userId, reload]);

  useBusy(!!sync && status === "connecting");

  if (error) return <div className="app-message">{t("doc.openError", { error })}</div>;
  if (!sync) return <div className="app-message">{t("doc.opening")}</div>;
  const editor = <ArticleEditor key={`${docId}:${reload}`} sync={sync} userId={userId} status={status} level={level} compact={compact} language={language} onLanguageChange={onLanguageChange} variant={variant} emptyText={emptyText} />;
  return refused ? (
    <>
      <div className="banner error" role="alert" onClick={() => setRefused(null)}>
        {refused} {t("doc.refused")}
      </div>
      {editor}
    </>
  ) : (
    editor
  );
};

export default DocEditor;
