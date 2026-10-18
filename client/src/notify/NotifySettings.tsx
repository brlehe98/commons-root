import { useEffect, useState } from "react";
import { X } from "lucide-react";
import "../fields/fields.css";
import { notifyServiceClient } from "@commons-root/gen-client";
import { NotifyKind, NotifyPref } from "@commons-root/gen-shared";
import { t } from "../i18n";

const groups = (): { title: string; kinds: { kind: NotifyKind; label: string }[] }[] => [
  {
    title: t("notify.comments"),
    kinds: [
      { kind: NotifyKind.MENTION, label: t("notify.mention") },
      { kind: NotifyKind.COMMENT, label: t("notify.comment") },
    ],
  },
  {
    title: t("notify.suggestions"),
    kinds: [
      { kind: NotifyKind.SUGGESTION_ADDED, label: t("notify.suggestionAdded") },
      { kind: NotifyKind.SUGGESTION_RESOLVED, label: t("notify.suggestionResolved") },
    ],
  },
  {
    title: t("notify.pages"),
    kinds: [
      { kind: NotifyKind.PAGE_UPDATED, label: t("notify.pageUpdated") },
      { kind: NotifyKind.REPORT, label: t("notify.report") },
    ],
  },
];

/** Each member picks which notifications they get. Root cannot mute one app. */
export function NotifyPrefs({ onClose }: { onClose: () => void }) {
  const [prefs, setPrefs] = useState<NotifyPref[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    notifyServiceClient
      .getPrefs()
      .then((r) => setPrefs(r.prefs))
      .catch((err) => setError(String(err?.message ?? err)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const toggle = (kind: NotifyKind, enabled: boolean) => {
    setPrefs((p) => p!.map((x) => (x.kind === kind ? { ...x, enabled } : x)));
    notifyServiceClient.setPrefs({ prefs: [{ kind, enabled }] }).catch((err) => setError(String(err?.message ?? err)));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal notify-prefs" role="dialog" aria-labelledby="notify-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2 id="notify-title">{t("app.notifications")}</h2>
          <button className="icon" title={t("common.close")} onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <p className="hint">{t("notify.hint")}</p>
        {error && <p className="field-error">{error}</p>}
        {!prefs && !error && <p className="hint">{t("app.loading")}</p>}
        {prefs &&
          groups().map((g) => (
            <fieldset key={g.title} className="pref-group">
              <legend>{g.title}</legend>
              {g.kinds.map(({ kind, label }) => (
                <label key={kind} className="pref-row">
                  <span>{label}</span>
                  <input
                    type="checkbox"
                    className="switch"
                    checked={prefs.find((p) => p.kind === kind)?.enabled ?? true}
                    onChange={(e) => toggle(kind, e.target.checked)}
                  />
                </label>
              ))}
            </fieldset>
          ))}
        <footer className="modal-foot">
          <span className="hint">{t("notify.savedAsYouGo")}</span>
          <button className="primary" onClick={onClose}>
            {t("common.done")}
          </button>
        </footer>
      </div>
    </div>
  );
}
