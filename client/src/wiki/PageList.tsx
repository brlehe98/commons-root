import React from "react";
import { PageSummary, PageType } from "@commons-root/gen-shared";
import FieldIcon from "../fields/FieldIcon";
import { pageRoute, useNav } from "./nav";
import { formatDate, typeOf } from "./api";
import { t } from "../i18n";

/** Search: the words around the match, with the matched words marked. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <p className="page-item-lead">
      {parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i}>{p.slice(1, -1)}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </p>
  );
}

type Props = {
  pages: PageSummary[];
  types: PageType[];
  empty: string;
  /** Show each page's space (search across spaces). */
  spaceNames?: Map<string, string>;
  /** Drafts list: open on the Edit tab. */
  drafts?: boolean;
};

const PageList: React.FC<Props> = ({ pages, types, empty, spaceNames, drafts }) => {
  const { go } = useNav();
  if (!pages.length) return <p className="hint list-empty">{empty}</p>;
  return (
    <ul className="page-list">
      {pages.map((p) => {
        const type = typeOf(types, p.typeId);
        return (
          <li key={p.id} className="page-item">
            <a
              href="#"
              className="page-item-title"
              onClick={(e) => {
                e.preventDefault();
                go(pageRoute(p.spaceId, p.id, drafts ? "edit" : undefined));
              }}
            >
              {p.title || t("page.untitled")}
            </a>
            <span className="page-item-meta">
              {type && (
                <span className="page-item-type">
                  <FieldIcon name={type.icon} size={13} /> {type.name}
                </span>
              )}
              {spaceNames?.get(p.spaceId) && <span>{spaceNames.get(p.spaceId)}</span>}
              {p.draftOnly ? <span className="page-item-draft">{t("page.neverPublished")}</span> : p.publishedAt > 0n && <span>{formatDate(p.publishedAt)}</span>}
            </span>
            {p.snippet ? <Snippet text={p.snippet} /> : p.lead && <p className="page-item-lead">{p.lead}</p>}
          </li>
        );
      })}
    </ul>
  );
};

export default PageList;
