import React from "react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { docServiceClient } from "@commons-root/gen-client";
import { FieldDef, FieldKind, FieldValue, PageType } from "@commons-root/gen-shared";
import FieldIcon from "../fields/FieldIcon";
import { fixDevHostImageUrl } from "../devHost";
import { valueOf } from "./api";
import { t } from "../i18n";

export const imageUrl = (uri: string) => fixDevHostImageUrl(rootClient.assets.toImageUrl(uri, ImageUriResolution.Original));

/** Asks Root for an image and stores it; resolves to its root:// address, or null when cancelled. */
export async function uploadImage(): Promise<string | null> {
  const { tokens } = await rootClient.assets.fileUpload({ fileType: "imageAll", multiple: false, windowTitle: t("field.chooseImage") });
  if (!tokens?.length) return null;
  return (await docServiceClient.commitPhoto({ token: tokens[0] })).uri;
}

/** One value as the infobox shows it. */
export function FieldValueView({ def, value }: { def: FieldDef; value: string }) {
  switch (def.kind) {
    case FieldKind.FIELD_LINK:
      return /^https?:\/\//i.test(value) ? (
        <a href={value} target="_blank" rel="noopener noreferrer">
          {value.replace(/^https?:\/\/(www\.)?/i, "").replace(/\/$/, "")}
        </a>
      ) : (
        <>{value}</>
      );
    case FieldKind.FIELD_IMAGE:
      return <img className="infobox-image" src={imageUrl(value)} alt={def.name} />;
    default:
      return <>{value}</>;
  }
}

type Props = { title: string; type: PageType | undefined; values: FieldValue[]; children?: React.ReactNode };

/** The box at the top right of a page, as on Wikipedia: the page type's fields and their values. */
const Infobox: React.FC<Props> = ({ title, type, values, children }) => {
  if (!type) return null;
  const images = type.fields.filter((f) => f.kind === FieldKind.FIELD_IMAGE && valueOf(values, f));
  const rows = type.fields.filter((f) => f.kind !== FieldKind.FIELD_IMAGE && valueOf(values, f));
  if (!images.length && !rows.length) return null;
  return (
    <aside className="infobox">
      <div className="infobox-title">{title}</div>
      <div className="infobox-type">
        <FieldIcon name={type.icon} size={13} /> {type.name}
      </div>
      {images.map((f) => (
        <figure key={f.id} className="infobox-figure">
          <FieldValueView def={f} value={valueOf(values, f)} />
          <figcaption>{f.name}</figcaption>
        </figure>
      ))}
      {rows.length > 0 && (
        <table>
          <tbody>
            {rows.map((f) => (
              <tr key={f.id}>
                <th scope="row">{f.name}</th>
                <td>
                  <FieldValueView def={f} value={valueOf(values, f)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {children}
    </aside>
  );
};

export default Infobox;
