import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, Globe, Layers, LayoutTemplate, Plus, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { AccessLevel, FieldDef, FieldKind, PageType, Role, RoleAccess, Space } from "@commons-root/gen-shared";
import SectionTitle from "../ui/SectionTitle";
import StylePicker from "../ui/StylePicker";
import TabIcon from "../ui/TabIcon";
import IconPicker from "../fields/IconPicker";
import FieldIcon from "../fields/FieldIcon";
import DocEditor from "../DocEditor";
import { confirmDialog } from "../ui/dialog";
import { reorder, useDragReorder } from "../ui/useDragReorder";
import { errorText, wiki } from "./api";
import { useNav } from "./nav";
import { t } from "../i18n";

const LEVELS: { level: AccessLevel; label: () => string }[] = [
  { level: AccessLevel.INVISIBLE, label: () => t("level.invisible") },
  { level: AccessLevel.READ, label: () => t("level.read") },
  { level: AccessLevel.COMMENT, label: () => t("level.comment") },
  { level: AccessLevel.EDIT, label: () => t("level.edit") },
  { level: AccessLevel.ADMIN, label: () => t("level.admin") },
];

const KINDS: { kind: FieldKind; label: () => string }[] = [
  { kind: FieldKind.FIELD_TEXT, label: () => t("fieldKind.text") },
  { kind: FieldKind.FIELD_LINK, label: () => t("fieldKind.link") },
  { kind: FieldKind.FIELD_NUMBER, label: () => t("fieldKind.number") },
  { kind: FieldKind.FIELD_DATE, label: () => t("fieldKind.date") },
  { kind: FieldKind.FIELD_CHOICE, label: () => t("fieldKind.choice") },
  { kind: FieldKind.FIELD_IMAGE, label: () => t("fieldKind.image") },
];

const templateDoc = (typeId: string) => `template:${typeId}`;

type Props = { spaces: Space[]; section?: string; onChanged: () => void };

/** For app admins: the spaces and who writes in them, and the page types. */
const Settings: React.FC<Props> = ({ spaces, section = "spaces", onChanged }) => {
  const { go, replace } = useNav();
  const [error, setError] = useState<string | null>(null);
  const space = spaces.find((s) => s.id === section);
  const open = (next: string) => replace({ view: "settings", section: next });
  // A space opens as a step forward: the back button returns to the list.
  const openSpace = (id: string) => go({ view: "settings", section: id });
  const act = async (fn: () => Promise<unknown>) => {
    try {
      setError(null);
      await fn();
      onChanged();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <div className="admin">
      <header className="admin-head">
        <h1>{t("app.settings")}</h1>
        <nav className="settings-nav" aria-label={t("admin.sections")}>
          <button className={section === "spaces" || space ? "settings-nav-item on" : "settings-nav-item"} onClick={() => open("spaces")}>
            <Layers size={15} /> {t("settings.spaces")}
          </button>
          <button className={section === "types" ? "settings-nav-item on" : "settings-nav-item"} onClick={() => open("types")}>
            <LayoutTemplate size={15} /> {t("settings.types")}
          </button>
        </nav>
      </header>
      {error && (
        <div className="banner error" onClick={() => setError(null)}>
          {error}
        </div>
      )}
      {space ? (
        <SpaceSettings key={space.id} space={space} act={act} onBack={() => open("spaces")} onError={setError} />
      ) : section === "types" ? (
        <PageTypes act={act} />
      ) : (
        <SpacesList spaces={spaces} act={act} onOpen={openSpace} />
      )}
    </div>
  );
};

const SpacesList: React.FC<{ spaces: Space[]; act: (fn: () => Promise<unknown>) => Promise<void>; onOpen: (id: string) => void }> = ({ spaces, act, onOpen }) => {
  const [roles, setRoles] = useState<Role[]>([]);
  const [name, setName] = useState("");
  const [roleId, setRoleId] = useState("");
  const [everyoneReads, setEveryoneReads] = useState(true);
  useEffect(() => {
    wiki
      .listRoles()
      .then((r) => setRoles(r.roles))
      .catch(() => setRoles([]));
  }, []);
  // The main space stays first.
  const groups = spaces.filter((s) => !s.main);
  const moveTo = (from: number, to: number) => act(() => wiki.reorderSpaces({ ids: reorder(groups.map((s) => s.id), from, to) }));
  const drag = useDragReorder(moveTo);

  return (
    <>
      <section>
        <SectionTitle icon={<Layers size={16} />}>{t("settings.spaces")}</SectionTitle>
        <p className="hint">{t("settings.spacesHint")}</p>
        {spaces
          .filter((s) => s.main)
          .map((s) => (
            <div key={s.id} className="ws-row">
              <span className="drag-grip placeholder" />
              <TabIcon icon={s.icon} color={s.color} size={16} fallback={<Globe size={16} />} />
              <span className="ws-name">
                {s.name} <span className="hint">{t("settings.mainSpace")}</span>
              </span>
              <button onClick={() => onOpen(s.id)}>{t("admin.openSettings")}</button>
            </div>
          ))}
        {groups.map((s, i) => (
          <div key={s.id} data-drag-row {...drag.row(i)} className={`ws-row ${drag.row(i).className}`}>
            {drag.grip(i)}
            <TabIcon icon={s.icon} color={s.color} size={16} fallback={<Users size={16} />} />
            <span className="ws-name">
              {s.name} <span className="hint">{s.everyoneReads ? t("settings.groupOpen") : t("settings.groupHidden")}</span>
            </span>
            <button className="icon" disabled={i === 0} title={t("common.moveUp")} onClick={() => moveTo(i, i - 1)}>
              <ArrowUp size={15} />
            </button>
            <button className="icon" disabled={i === groups.length - 1} title={t("common.moveDown")} onClick={() => moveTo(i, i + 1)}>
              <ArrowDown size={15} />
            </button>
            <button onClick={() => onOpen(s.id)}>{t("admin.openSettings")}</button>
          </div>
        ))}
      </section>
      <section>
        <SectionTitle icon={<Users size={16} />}>{t("settings.newGroup")}</SectionTitle>
        <p className="hint">{t("settings.newGroupHint")}</p>
        <form
          className="new-group"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !roleId) return;
            act(async () => {
              const { space } = await wiki.saveSpace({ id: "", name: name.trim(), roleId, everyoneReads });
              setName("");
              if (space) onOpen(space.id);
            });
          }}
        >
          <label className="detail">
            <span>{t("settings.groupName")}</span>
            <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="detail">
            <span>{t("settings.groupRole")}</span>
            <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
              <option value="">{t("settings.chooseRole")}</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={everyoneReads} onChange={(e) => setEveryoneReads(e.target.checked)} /> {t("settings.everyoneReads")}
          </label>
          <button type="submit" className="primary" disabled={!name.trim() || !roleId}>
            {t("admin.create")}
          </button>
        </form>
      </section>
    </>
  );
};

const SpaceSettings: React.FC<{
  space: Space;
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onBack: () => void;
  onError: (message: string) => void;
}> = ({ space, act, onBack, onError }) => {
  const remove = async () =>
    (await confirmDialog(t("settings.confirmDeleteGroup", { name: space.name }), { ok: t("common.delete"), danger: true })) &&
    act(async () => {
      await wiki.deleteSpace({ id: space.id });
      onBack();
    });
  return (
    <>
      <button className="link back-link" onClick={onBack}>
        <ArrowLeft size={15} /> {t("settings.spaces")}
      </button>
      <section>
        <SectionTitle icon={space.main ? <Globe size={16} /> : <Users size={16} />}>{space.main ? t("settings.mainSpace") : t("settings.group")}</SectionTitle>
        <div className="ws-row">
          <StylePicker
            icon={space.icon}
            color={space.color}
            fallback={space.main ? <Globe size={16} /> : <Users size={16} />}
            onChange={(style) => act(() => wiki.setSpaceStyle({ id: space.id, ...style }))}
          />
          <input
            defaultValue={space.name}
            aria-label={t("settings.groupName")}
            maxLength={80}
            onBlur={(e) =>
              e.target.value.trim() &&
              e.target.value.trim() !== space.name &&
              act(() => wiki.saveSpace({ id: space.id, name: e.target.value.trim(), roleId: "", everyoneReads: space.everyoneReads }))
            }
            onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          />
          {!space.main && (
            <button className="danger" onClick={remove}>
              <Trash2 size={14} /> {t("settings.deleteGroup")}
            </button>
          )}
        </div>
        {space.main ? (
          <p className="hint">{t("settings.mainHint")}</p>
        ) : (
          <label className="check">
            <input
              type="checkbox"
              checked={space.everyoneReads}
              onChange={(e) => act(() => wiki.saveSpace({ id: space.id, name: space.name, roleId: "", everyoneReads: e.target.checked }))}
            />{" "}
            {t("settings.everyoneReads")}
          </label>
        )}
      </section>
      <AccessEditor space={space} onError={onError} />
    </>
  );
};

const AccessEditor: React.FC<{ space: Space; onError: (msg: string) => void }> = ({ space, onError }) => {
  const [roles, setRoles] = useState<RoleAccess[] | null>(null);
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    wiki
      .getAccess({ spaceId: space.id })
      .then((res) => setRoles(res.roles))
      .catch((err) => onError(errorText(err)));
  }, [space.id]);
  if (!roles) return <section>{t("admin.loadingRoles")}</section>;
  // In the main space and open groups, everyone reads at least.
  const floor = space.main || space.everyoneReads ? AccessLevel.READ : AccessLevel.INVISIBLE;
  return (
    <section>
      <SectionTitle icon={<ShieldCheck size={16} />}>{t("settings.whoWrites", { name: space.name })}</SectionTitle>
      <p className="hint">{floor ? t("settings.accessHintOpen") : t("settings.accessHintHidden")}</p>
      <table className="access">
        <tbody>
          {roles.map((r) => (
            <tr key={r.roleId}>
              <td>
                <span className="dot" style={{ background: r.roleColor || "var(--muted)" }} /> {r.roleName}
              </td>
              <td>
                <select
                  value={Math.max(r.level, floor)}
                  disabled={r.appAdmin}
                  title={r.appAdmin ? t("admin.appAdminTitle") : undefined}
                  onChange={(e) => {
                    setRoles(roles.map((x) => (x.roleId === r.roleId ? { ...x, level: Number(e.target.value) } : x)));
                    setSaved(false);
                  }}
                >
                  {LEVELS.filter((l) => l.level >= floor).map((l) => (
                    <option key={l.level} value={l.level}>
                      {l.label()}
                    </option>
                  ))}
                </select>
                {r.appAdmin && <span className="hint"> {t("admin.appAdmin")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        className="primary"
        disabled={saved}
        onClick={() =>
          wiki
            .setAccess({ spaceId: space.id, roles })
            .then(() => setSaved(true))
            .catch((err) => onError(errorText(err)))
        }
      >
        {saved ? t("common.saved") : t("admin.saveAccess")}
      </button>
    </section>
  );
};

/** Kinds of pages: the fields of their infobox and the text a new page starts from. */
const PageTypes: React.FC<{ act: (fn: () => Promise<unknown>) => Promise<void> }> = ({ act }) => {
  const [types, setTypes] = useState<PageType[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = () => wiki.listPageTypes().then((r) => setTypes(r.types));
  useEffect(() => {
    load().catch(() => setTypes([]));
  }, []);
  const run = (fn: () => Promise<unknown>) => act(async () => (await fn(), await load()));
  const moveTo = (from: number, to: number) => types && run(() => wiki.reorderPageTypes({ ids: reorder(types.map((x) => x.id), from, to) }));
  const drag = useDragReorder(moveTo);
  if (!types) return <section>{t("app.loading")}</section>;
  const open = types.find((x) => x.id === openId);
  if (open) return <PageTypeEditor key={open.id} type={open} run={run} onClose={() => setOpenId(null)} />;
  return (
    <section>
      <SectionTitle icon={<LayoutTemplate size={16} />}>{t("settings.types")}</SectionTitle>
      <p className="hint">{t("settings.typesHint")}</p>
      {types.map((tp, i) => (
        <div key={tp.id} data-drag-row {...drag.row(i)} className={`ws-row ${drag.row(i).className}`}>
          {drag.grip(i)}
          <FieldIcon name={tp.icon} size={16} />
          <span className="ws-name">
            {tp.name} <span className="hint">{t("settings.fieldCount", { count: tp.fields.length })}</span>
          </span>
          <button className="icon" disabled={i === 0} title={t("common.moveUp")} onClick={() => moveTo(i, i - 1)}>
            <ArrowUp size={15} />
          </button>
          <button className="icon" disabled={i === types.length - 1} title={t("common.moveDown")} onClick={() => moveTo(i, i + 1)}>
            <ArrowDown size={15} />
          </button>
          <button onClick={() => setOpenId(tp.id)}>{t("admin.openSettings")}</button>
        </div>
      ))}
      <button
        onClick={() =>
          run(async () => {
            const { type } = await wiki.savePageType({ id: "", name: t("settings.newType"), icon: "File", fields: [], position: 0 });
            if (type) setOpenId(type.id);
          })
        }
      >
        <Plus size={15} /> {t("settings.addType")}
      </button>
    </section>
  );
};

const PageTypeEditor: React.FC<{ type: PageType; run: (fn: () => Promise<unknown>) => Promise<void>; onClose: () => void }> = ({ type, run, onClose }) => {
  const [draft, setDraft] = useState<PageType>(type);
  const [dirty, setDirty] = useState(false);
  const change = (next: PageType) => {
    setDraft(next);
    setDirty(true);
  };
  const setField = (i: number, f: FieldDef) => change({ ...draft, fields: draft.fields.map((x, j) => (j === i ? f : x)) });
  const moveField = (from: number, to: number) => change({ ...draft, fields: reorder(draft.fields, from, to) });
  const drag = useDragReorder(moveField);
  const save = () => run(() => wiki.savePageType(draft)).then(() => setDirty(false));
  const remove = async () =>
    (await confirmDialog(t("settings.confirmDeleteType", { name: type.name }), { ok: t("common.delete"), danger: true })) &&
    run(() => wiki.deletePageType({ id: type.id })).then(onClose);

  return (
    <>
      <section>
        <SectionTitle icon={<LayoutTemplate size={16} />}>{t("settings.type")}</SectionTitle>
        <div className="ws-row">
          <IconPicker value={draft.icon} color="" onChange={(icon) => change({ ...draft, icon })} />
          <input value={draft.name} maxLength={80} aria-label={t("settings.typeName")} onChange={(e) => change({ ...draft, name: e.target.value })} />
          <button className="danger" onClick={remove}>
            <Trash2 size={14} /> {t("settings.deleteType")}
          </button>
        </div>
        <h3 className="sub-title">{t("settings.fields")}</h3>
        <p className="hint">{t("settings.fieldsHint")}</p>
        {draft.fields.map((f, i) => (
          <div key={f.id || i} data-drag-row {...drag.row(i)} className={`field-row ${drag.row(i).className}`}>
            {drag.grip(i)}
            <input value={f.name} placeholder={t("settings.fieldName")} maxLength={80} onChange={(e) => setField(i, { ...f, name: e.target.value })} />
            <select value={f.kind} onChange={(e) => setField(i, { ...f, kind: Number(e.target.value) as FieldKind })} aria-label={t("settings.fieldKind")}>
              {KINDS.map((k) => (
                <option key={k.kind} value={k.kind}>
                  {k.label()}
                </option>
              ))}
            </select>
            {f.kind === FieldKind.FIELD_CHOICE && (
              <input
                className="field-options"
                defaultValue={f.options.join(", ")}
                placeholder={t("settings.choices")}
                onBlur={(e) => setField(i, { ...f, options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
              />
            )}
            <button className="icon" title={t("settings.removeField")} onClick={() => change({ ...draft, fields: draft.fields.filter((_, j) => j !== i) })}>
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="row-actions">
          <button onClick={() => change({ ...draft, fields: [...draft.fields, { id: "", name: "", kind: FieldKind.FIELD_TEXT, options: [] }] })}>
            <Plus size={15} /> {t("settings.addField")}
          </button>
          <span className="spacer" />
          <button onClick={onClose}>{t("settings.backToTypes")}</button>
          <button className="primary" disabled={!dirty} onClick={save}>
            {dirty ? t("common.save") : t("common.saved")}
          </button>
        </div>
      </section>
      <section className="wide">
        <SectionTitle icon={<BookOpen size={16} />}>{t("settings.template")}</SectionTitle>
        <p className="hint">{t("settings.templateHint")}</p>
        <div className="template-editor">
          <DocEditor docId={templateDoc(type.id)} level={AccessLevel.ADMIN} variant="wiki" />
        </div>
      </section>
    </>
  );
};

export default Settings;
