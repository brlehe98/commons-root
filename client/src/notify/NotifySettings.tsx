import { useEffect, useState } from "react";
import { BellRing, Plus, X } from "lucide-react";
import SectionTitle from "../ui/SectionTitle";
import "../fields/fields.css";
import { boardServiceClient, notifyServiceClient } from "@commons-root/gen-client";
import { Column, NotifyKind, NotifyPref, NotifyRule, RoleAccess, Workspace } from "@commons-root/gen-shared";
import { BOARD_COLUMNS, PUBLISHED_STAGE } from "../board/columns";
import { getStage } from "../board/stageColors";
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
    title: t("notify.myProjects"),
    kinds: [
      { kind: NotifyKind.COLUMN_CHANGED, label: t("notify.columnChanged") },
      { kind: NotifyKind.STATUS_CHANGED, label: t("notify.statusChanged") },
      { kind: NotifyKind.DUE_TOMORROW, label: t("notify.due") },
    ],
  },
  {
    title: t("notify.myRoles"),
    kinds: [
      { kind: NotifyKind.APPROVAL_NEEDED, label: t("notify.approvalNeeded") },
      { kind: NotifyKind.RULE, label: t("notify.rule") },
    ],
  },
];

const stageName = (column: Column, fallback: string) => getStage(column)?.label || fallback;

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

/** Admin rules: tell a role when a card enters a column. */
export function NotifyRules({ workspaces }: { workspaces: Workspace[] }) {
  const [rules, setRules] = useState<NotifyRule[] | null>(null);
  const [roles, setRoles] = useState<RoleAccess[]>([]);
  const [saved, setSaved] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    notifyServiceClient
      .listRules()
      .then((r) => setRules(r.rules))
      .catch((err) => setError(String(err?.message ?? err)));
    boardServiceClient.getAccess({ workspaceId: "" }).then((r) => setRoles(r.roles)).catch(() => undefined);
  }, []);

  if (!rules) return null;
  const update = (i: number, patch: Partial<NotifyRule>) => {
    setRules(rules.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    setSaved(false);
  };
  const save = () =>
    notifyServiceClient
      .saveRules({ rules })
      .then(() => setSaved(true))
      .catch((err) => setError(String(err?.message ?? err)));

  return (
    <section>
      <SectionTitle icon={<BellRing size={16} />}>{t("notify.rules")}</SectionTitle>
      <p className="hint">{t("notify.rulesHint")}</p>
      {error && <p className="field-error">{error}</p>}
      {rules.map((r, i) => (
        <div key={i} className="rule-row">
          <span className="condition-word">{t("notify.tell")}</span>
          <select value={r.roleId} onChange={(e) => update(i, { roleId: e.target.value })}>
            <option value="">{t("notify.pickRole")}</option>
            {roles.map((role) => (
              <option key={role.roleId} value={role.roleId}>
                {role.roleName}
              </option>
            ))}
          </select>
          <span className="condition-word">{t("notify.whenCardOf")}</span>
          <select value={r.workspaceId} onChange={(e) => update(i, { workspaceId: e.target.value })}>
            <option value="">{t("notify.anyWorkspace")}</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <span className="condition-word">{t("notify.enters")}</span>
          <select value={r.column} onChange={(e) => update(i, { column: Number(e.target.value) })}>
            {[...BOARD_COLUMNS, PUBLISHED_STAGE].map((c) => (
              <option key={c.column} value={c.column}>
                {stageName(c.column, c.label)}
              </option>
            ))}
          </select>
          <button className="icon" title={t("notify.removeRule")} onClick={() => (setRules(rules.filter((_, k) => k !== i)), setSaved(false))}>
            <X size={15} />
          </button>
        </div>
      ))}
      {!rules.length && <p className="hint">{t("notify.noRule")}</p>}
      <div className="section-actions">
        <button
          className="with-icon"
          onClick={() => {
            setRules([...rules, { id: "", workspaceId: "", column: Column.FOR_REVIEW, roleId: "" }]);
            setSaved(false);
          }}
        >
          <Plus size={15} /> {t("notify.addRule")}
        </button>
        <span className="spacer" />
        <button className="primary" disabled={saved} onClick={save}>
          {saved ? t("common.saved") : t("notify.saveRules")}
        </button>
      </div>
    </section>
  );
}
