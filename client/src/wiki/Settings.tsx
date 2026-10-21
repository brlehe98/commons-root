import React, { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, ChevronRight, Globe, Layers, LayoutTemplate, Lock, Plus, ShieldCheck, Trash2, Users, X } from "lucide-react";
import { AccessLevel, FieldDef, FieldKind, PageType, RoleAccess, Space } from "@commons-root/gen-shared";
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
  const typeId = section.startsWith("type:") ? section.slice(5) : null;
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
          <button className={section === "types" || typeId ? "settings-nav-item on" : "settings-nav-item"} onClick={() => open("types")}>
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
      ) : section === "types" || typeId ? (
        <PageTypes act={act} openId={typeId} onOpen={(id) => (id ? go({ view: "settings", section: `type:${id}` }) : open("types"))} />
      ) : (
        <SpacesList spaces={spaces} act={act} onOpen={openSpace} />
      )}
    </div>
  );
};

const SpacesList: React.FC<{
  spaces: Space[];
  act: (fn: () => Promise<unknown>) => Promise<void>;
  onOpen: (id: string) => void;
}> = ({ spaces, act, onOpen }) => {
  const [name, setName] = useState("");
  const [everyoneReads, setEveryoneReads] = useState(true);
  // The new space's form opens on demand.
  const [adding, setAdding] = useState(false);
  // The main space stays first.
  const groups = spaces.filter((s) => !s.main);
  const moveTo = (from: number, to: number) =>
    act(() =>
      wiki.reorderSpaces({
        ids: reorder(
          groups.map((s) => s.id),
          from,
          to,
        ),
      }),
    );
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
              <button className="row-open" onClick={() => onOpen(s.id)}>
                {t("admin.openSettings")} <ChevronRight size={15} />
              </button>
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
            <button className="row-open" onClick={() => onOpen(s.id)}>
              {t("admin.openSettings")} <ChevronRight size={15} />
            </button>
          </div>
        ))}
        {!adding ? (
          <button className="add-row" onClick={() => setAdding(true)}>
            <Plus size={15} /> {t("settings.newSpace")}
          </button>
        ) : (
          <form
            className="new-group"
            onSubmit={(e) => {
              e.preventDefault();
              if (!name.trim()) return;
              act(async () => {
                const { space } = await wiki.saveSpace({
                  id: "",
                  name: name.trim(),
                  roleId: "",
                  everyoneReads,
                });
                setName("");
                setAdding(false);
                if (space) onOpen(space.id);
              });
            }}
          >
            <h3 className="sub-title">
              <Layers size={15} /> {t("settings.newSpace")}
            </h3>
            <label className="detail">
              <span>{t("settings.groupName")}</span>
              <input value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
            </label>
            <WhoReads everyone={everyoneReads} onChange={setEveryoneReads} />
            <p className="hint">{t("settings.newSpaceHint")}</p>
            <div className="row-actions">
              <button type="button" onClick={() => setAdding(false)}>
                {t("common.cancel")}
              </button>
              <button type="submit" className="primary" disabled={!name.trim()}>
                {t("admin.create")}
              </button>
            </div>
          </form>
        )}
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
              act(() =>
                wiki.saveSpace({
                  id: space.id,
                  name: e.target.value.trim(),
                  roleId: "",
                  everyoneReads: space.everyoneReads,
                }),
              )
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
          <WhoReads
            everyone={space.everyoneReads}
            onChange={(everyoneReads) => act(() => wiki.saveSpace({ id: space.id, name: space.name, roleId: "", everyoneReads }))}
          />
        )}
      </section>
      <AccessEditor space={space} onError={onError} />
    </>
  );
};

/** Who reads a space: everyone in the community, or only the roles listed below. */
const WhoReads: React.FC<{ everyone: boolean; onChange: (everyone: boolean) => void }> = ({ everyone, onChange }) => (
  <fieldset className="who-reads">
    <legend>{t("settings.whoHasAccess")}</legend>
    <label>
      <input type="radio" checked={everyone} onChange={() => onChange(true)} /> <Globe size={15} /> {t("settings.everyone")}
    </label>
    <label>
      <input type="radio" checked={!everyone} onChange={() => onChange(false)} /> <Users size={15} /> {t("settings.chosenRoles")}
    </label>
  </fieldset>
);

/**
 * The roles with more than the space's floor: everyone reads an open space,
 * so its list only holds who writes or manages; a closed one lists its readers too.
 * Each change saves at once.
 */
const AccessEditor: React.FC<{
  space: Space;
  onError: (msg: string) => void;
}> = ({ space, onError }) => {
  const [roles, setRoles] = useState<RoleAccess[] | null>(null);
  useEffect(() => {
    wiki
      .getAccess({ spaceId: space.id })
      .then((res) => setRoles(res.roles))
      .catch((err) => onError(errorText(err)));
  }, [space.id]);
  if (!roles) return <section>{t("admin.loadingRoles")}</section>;
  const floor = space.main || space.everyoneReads ? AccessLevel.READ : AccessLevel.INVISIBLE;
  const save = (roleId: string, level: AccessLevel) => {
    const next = roles.map((x) => (x.roleId === roleId ? { ...x, level } : x));
    setRoles(next);
    wiki.setAccess({ spaceId: space.id, roles: next }).catch((err) => onError(errorText(err)));
  };
  const listed = roles.filter((r) => r.appAdmin || r.level > floor);
  const others = roles.filter((r) => !r.appAdmin && r.level <= floor);
  const choices = LEVELS.filter((l) => l.level > floor);
  return (
    <section>
      <SectionTitle icon={<ShieldCheck size={16} />}>{floor ? t("settings.whoWrites", { name: space.name }) : t("settings.whoReadsWrites", { name: space.name })}</SectionTitle>
      <p className="hint">{floor ? t("settings.accessHintOpen") : t("settings.accessHintHidden")}</p>
      {listed.length > 0 && (
        <table className="access">
          <tbody>
            {listed.map((r) => (
              <tr key={r.roleId}>
                <td>
                  <span className="dot" style={{ background: r.roleColor || "var(--muted)" }} /> {r.roleName}
                </td>
                <td>
                  {r.appAdmin ? (
                    <span className="hint locked" title={t("admin.appAdminTitle")}>
                      <Lock size={14} /> {t("level.admin")}
                    </span>
                  ) : (
                    <>
                      <select value={r.level} aria-label={r.roleName} onChange={(e) => save(r.roleId, Number(e.target.value))}>
                        {choices.map((l) => (
                          <option key={l.level} value={l.level}>
                            {l.label()}
                          </option>
                        ))}
                      </select>
                      <button className="icon" title={t("settings.removeRole")} onClick={() => save(r.roleId, AccessLevel.INVISIBLE)}>
                        <X size={15} />
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {others.length > 0 && (
        <select className="add-role" value="" aria-label={t("settings.addRole")} onChange={(e) => e.target.value && save(e.target.value, choices[0].level)}>
          <option value="">+ {t("settings.addRole")}</option>
          {others.map((r) => (
            <option key={r.roleId} value={r.roleId}>
              {r.roleName}
            </option>
          ))}
        </select>
      )}
    </section>
  );
};

/** Kinds of pages: the fields of their infobox and the text a new page starts from. */
// A type opens as a step forward, like a space: the back button returns to the list.
const PageTypes: React.FC<{
  act: (fn: () => Promise<unknown>) => Promise<void>;
  openId: string | null;
  onOpen: (id: string | null) => void;
}> = ({ act, openId, onOpen }) => {
  const [types, setTypes] = useState<PageType[] | null>(null);
  const load = () => wiki.listPageTypes().then((r) => setTypes(r.types));
  useEffect(() => {
    load().catch(() => setTypes([]));
  }, []);
  const run = (fn: () => Promise<unknown>) => act(async () => (await fn(), await load()));
  const moveTo = (from: number, to: number) =>
    types &&
    run(() =>
      wiki.reorderPageTypes({
        ids: reorder(
          types.map((x) => x.id),
          from,
          to,
        ),
      }),
    );
  const drag = useDragReorder(moveTo);
  if (!types) return <section>{t("app.loading")}</section>;
  const open = types.find((x) => x.id === openId);
  if (open) return <PageTypeEditor key={open.id} type={open} run={run} onClose={() => onOpen(null)} />;
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
          <button className="row-open" onClick={() => onOpen(tp.id)}>
            {t("admin.openSettings")} <ChevronRight size={15} />
          </button>
        </div>
      ))}
      <button
        onClick={() =>
          run(async () => {
            const { type } = await wiki.savePageType({
              id: "",
              name: t("settings.newType"),
              icon: "File",
              fields: [],
              position: 0,
            });
            if (type) onOpen(type.id);
          })
        }
      >
        <Plus size={15} /> {t("settings.addType")}
      </button>
    </section>
  );
};

const PageTypeEditor: React.FC<{
  type: PageType;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  onClose: () => void;
}> = ({ type, run, onClose }) => {
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
    (await confirmDialog(t("settings.confirmDeleteType", { name: type.name }), {
      ok: t("common.delete"),
      danger: true,
    })) && run(() => wiki.deletePageType({ id: type.id })).then(onClose);

  return (
    <>
      <button className="link back-link" onClick={onClose}>
        <ArrowLeft size={15} /> {t("settings.types")}
      </button>
      <section>
        <SectionTitle icon={<LayoutTemplate size={16} />}>{t("settings.type")}</SectionTitle>
        <div className="ws-row">
          <IconPicker value={draft.icon} color="" onChange={(icon) => change({ ...draft, icon })} />
          <input value={draft.name} maxLength={80} aria-label={t("settings.typeName")} onChange={(e) => change({ ...draft, name: e.target.value })} />
          <button className="danger type-delete" title={t("settings.deleteType")} onClick={remove}>
            <Trash2 size={14} /> <span className="btn-label">{t("settings.deleteType")}</span>
          </button>
        </div>
        <h3 className="sub-title">{t("settings.fields")}</h3>
        <p className="hint">{t("settings.fieldsHint")}</p>
        {draft.fields.map((f, i) => (
          <div key={f.id || i} data-drag-row {...drag.row(i)} className={`field-row ${drag.row(i).className}`}>
            {drag.grip(i)}
            <IconPicker value={f.icon} color="" onChange={(icon) => setField(i, { ...f, icon })} />
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
                onBlur={(e) =>
                  setField(i, {
                    ...f,
                    options: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
              />
            )}
            <button
              className="icon"
              title={t("settings.removeField")}
              onClick={() =>
                change({
                  ...draft,
                  fields: draft.fields.filter((_, j) => j !== i),
                })
              }
            >
              <X size={15} />
            </button>
          </div>
        ))}
        <div className="row-actions">
          <button
            onClick={() =>
              change({
                ...draft,
                fields: [
                  ...draft.fields,
                  {
                    id: "",
                    name: "",
                    icon: "",
                    kind: FieldKind.FIELD_TEXT,
                    options: [],
                  },
                ],
              })
            }
          >
            <Plus size={15} /> {t("settings.addField")}
          </button>
          <span className="spacer" />
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
