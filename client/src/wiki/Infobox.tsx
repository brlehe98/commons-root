import React, { useEffect, useState } from "react";
import { ImagePlus, ImageUp, Trash2 } from "lucide-react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { docServiceClient } from "@commons-root/gen-client";
import { FieldDef, FieldKind, FieldValue, PageType } from "@commons-root/gen-shared";
import FieldIcon from "../fields/FieldIcon";
import { fixDevHostImageUrl } from "../devHost";
import { valueOf } from "./api";
import Lightbox, { StoredImage } from "./Lightbox";
import { locale, t } from "../i18n";

export const imageUrl = (uri: string) => fixDevHostImageUrl(rootClient.assets.toImageUrl(uri, ImageUriResolution.Original));

/** Asks Root for an image and stores it; resolves to its root:// address, or null when cancelled. */
export async function uploadImage(): Promise<string | null> {
  const { tokens } = await rootClient.assets.fileUpload({ fileType: "imageAll", multiple: false, windowTitle: t("field.chooseImage") });
  if (!tokens?.length) return null;
  return (await docServiceClient.commitPhoto({ token: tokens[0] })).uri;
}

/** An image field holds the photo's address, then its caption on a line of its own. */
export function splitImage(value: string): { uri: string; caption: string } {
  const at = value.indexOf("\n");
  return at < 0 ? { uri: value.trim(), caption: "" } : { uri: value.slice(0, at).trim(), caption: value.slice(at + 1).trim() };
}
export const joinImage = (uri: string, caption: string) => (uri ? (caption.trim() ? `${uri}\n${caption.trim()}` : uri) : "");

/** A date field ("2024", "2024-05", "2024-05-12") written the reader's way. */
function formatFieldDate(value: string): string {
  const [y, m, d] = value.split("-").map(Number);
  if (!y) return value;
  try {
    if (!m) return String(y);
    const date = new Date(Date.UTC(y, m - 1, d || 1));
    return date.toLocaleDateString(locale(), d ? { dateStyle: "long", timeZone: "UTC" } : { month: "long", year: "numeric", timeZone: "UTC" });
  } catch {
    return value;
  }
}

/** One value as the infobox shows it. */
export function FieldValueView({ def, value }: { def: FieldDef; value: string }) {
  switch (def.kind) {
    case FieldKind.FIELD_LINK:
      return /^https?:\/\//i.test(value) ? (
        <a className="external" href={value} target="_blank" rel="noopener noreferrer">
          {value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
        </a>
      ) : (
        <>{value}</>
      );
    case FieldKind.FIELD_DATE:
      return <>{formatFieldDate(value)}</>;
    case FieldKind.FIELD_IMAGE:
      return <StoredImage className="infobox-photo" uri={splitImage(value).uri} alt={splitImage(value).caption || def.name} />;
    default:
      return <>{value}</>;
  }
}

type Props = { title: string; type: PageType | undefined; values: FieldValue[] };

/**
 * The box at the top right of a page, as on Wikipedia: the title over a
 * tinted band, the photos with their captions, then one row per field.
 */
const Infobox: React.FC<Props> = ({ title, type, values }) => {
  const [photo, setPhoto] = useState<{ uri: string; caption: string } | null>(null);
  if (!type) return null;
  const images = type.fields.filter((f) => f.kind === FieldKind.FIELD_IMAGE && splitImage(valueOf(values, f)).uri);
  const rows = type.fields.filter((f) => f.kind !== FieldKind.FIELD_IMAGE && valueOf(values, f));
  if (!images.length && !rows.length) return null;
  return (
    <>
      <table className="infobox">
        <tbody>
          <tr>
            <th colSpan={2} className="infobox-above">
              {title}
            </th>
          </tr>
          <tr>
            <td colSpan={2} className="infobox-subheader">
              <FieldIcon name={type.icon} size={13} /> {type.name}
            </td>
          </tr>
          {images.map((f) => {
            const { uri, caption } = splitImage(valueOf(values, f));
            return (
              <tr key={f.id}>
                <td colSpan={2} className="infobox-image">
                  <button className="thumb-open" title={t("read.openPhoto")} onClick={() => setPhoto({ uri, caption })}>
                    <StoredImage uri={uri} alt={caption || f.name} />
                  </button>
                  {caption && <div className="infobox-caption">{caption}</div>}
                </td>
              </tr>
            );
          })}
          {rows.map((f) => (
            <tr key={f.id}>
              <th scope="row" className="infobox-label">
                {f.name}
              </th>
              <td className="infobox-data">
                <FieldValueView def={f} value={valueOf(values, f)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {photo && <Lightbox uri={photo.uri} caption={photo.caption} onClose={() => setPhoto(null)} />}
    </>
  );
};

type EditorProps = {
  title: string;
  type: PageType | undefined;
  types: PageType[];
  values: FieldValue[];
  /** Fields can be filled in (edit access). */
  canEdit: boolean;
  /** The page's type can be changed (publish access). */
  canChangeType: boolean;
  onValue: (def: FieldDef, value: string) => void;
  onType: (typeId: string) => void;
  onError: (message: string) => void;
};

/** The infobox in the page being edited: each value is written in its own row. */
export const InfoboxEditor: React.FC<EditorProps> = ({ title, type, types, values, canEdit, canChangeType, onValue, onType, onError }) => {
  const typePicker = canChangeType && types.length > 0 && (
    <select className="infobox-type-select" value={type?.id ?? ""} aria-label={t("page.type")} onChange={(e) => onType(e.target.value)}>
      {!type && <option value="">{t("infobox.chooseType")}</option>}
      {types.map((tp) => (
        <option key={tp.id} value={tp.id}>
          {tp.name}
        </option>
      ))}
    </select>
  );
  if (!type) {
    if (!typePicker) return null;
    return (
      <div className="infobox infobox-empty">
        <span>{t("infobox.add")}</span>
        {typePicker}
      </div>
    );
  }
  const images = type.fields.filter((f) => f.kind === FieldKind.FIELD_IMAGE);
  const rows = type.fields.filter((f) => f.kind !== FieldKind.FIELD_IMAGE);
  return (
    <table className="infobox editing">
      <tbody>
        <tr>
          <th colSpan={2} className="infobox-above">
            {title || t("page.untitled")}
          </th>
        </tr>
        <tr>
          <td colSpan={2} className="infobox-subheader">
            <FieldIcon name={type.icon} size={13} /> {typePicker || type.name}
          </td>
        </tr>
        {images.map((f) => (
          <tr key={f.id}>
            <td colSpan={2} className="infobox-image">
              <ImageValue def={f} value={valueOf(values, f)} canEdit={canEdit} onValue={(v) => onValue(f, v)} onError={onError} />
            </td>
          </tr>
        ))}
        {rows.map((f) => (
          <tr key={f.id}>
            <th scope="row" className="infobox-label">
              {f.name}
            </th>
            <td className="infobox-data">
              <ValueInput def={f} value={valueOf(values, f)} disabled={!canEdit} onValue={(v) => onValue(f, v)} />
            </td>
          </tr>
        ))}
        {!type.fields.length && (
          <tr>
            <td colSpan={2} className="infobox-hint">
              {t("infobox.noFields")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  );
};

/** A value written in place: kept as typed, saved when left. */
const ValueInput: React.FC<{ def: FieldDef; value: string; disabled: boolean; onValue: (value: string) => void }> = ({ def, value, disabled, onValue }) => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const leave = () => text.trim() !== value && onValue(text.trim());
  if (def.kind === FieldKind.FIELD_CHOICE)
    return (
      <select className="infobox-input" value={value} disabled={disabled} aria-label={def.name} onChange={(e) => onValue(e.target.value)}>
        <option value="">{t("infobox.empty")}</option>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  const common = {
    className: "infobox-input",
    value: text,
    disabled,
    "aria-label": def.name,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setText(e.target.value),
    onBlur: leave,
  };
  if (def.kind === FieldKind.FIELD_TEXT)
    return (
      <textarea
        {...common}
        rows={1}
        maxLength={500}
        placeholder={t("infobox.empty")}
        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), e.currentTarget.blur())}
      />
    );
  return (
    <input
      {...common}
      type={def.kind === FieldKind.FIELD_LINK ? "url" : "text"}
      inputMode={def.kind === FieldKind.FIELD_NUMBER ? "decimal" : undefined}
      maxLength={500}
      placeholder={def.kind === FieldKind.FIELD_DATE ? t("field.datePlaceholder") : def.kind === FieldKind.FIELD_LINK ? "https://" : t("infobox.empty")}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
};

/** A photo of the infobox: added, replaced or removed in place, with its caption under it. */
const ImageValue: React.FC<{ def: FieldDef; value: string; canEdit: boolean; onValue: (value: string) => void; onError: (message: string) => void }> = ({
  def,
  value,
  canEdit,
  onValue,
  onError,
}) => {
  const { uri, caption } = splitImage(value);
  const [text, setText] = useState(caption);
  useEffect(() => setText(caption), [caption]);
  const choose = () =>
    uploadImage()
      .then((next) => next && onValue(joinImage(next, text)))
      .catch((err) => onError(String((err as Error)?.message ?? err)));
  if (!uri)
    return (
      <button className="infobox-add-image" disabled={!canEdit} onClick={choose}>
        <ImagePlus size={18} />
        <span>{t("infobox.addImage", { field: def.name })}</span>
      </button>
    );
  return (
    <>
      <div className="infobox-image-edit">
        <StoredImage uri={uri} alt={caption || def.name} />
        {canEdit && (
          <span className="infobox-image-tools">
            <button className="icon" title={t("field.replaceImage")} onClick={choose}>
              <ImageUp size={15} />
            </button>
            <button className="icon" title={t("field.removeImage")} onClick={() => onValue("")}>
              <Trash2 size={15} />
            </button>
          </span>
        )}
      </div>
      <textarea
        className="infobox-input infobox-caption"
        rows={1}
        value={text}
        disabled={!canEdit}
        maxLength={300}
        placeholder={t("infobox.caption")}
        aria-label={t("infobox.caption")}
        onChange={(e) => setText(e.target.value.replace(/\n/g, " "))}
        onBlur={() => text.trim() !== caption && onValue(joinImage(uri, text))}
        onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), e.currentTarget.blur())}
      />
    </>
  );
};

export default Infobox;
