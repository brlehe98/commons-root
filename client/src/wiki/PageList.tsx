import React from "react";
import { Category, PageSummary, PageType } from "@commons-root/gen-shared";
import FieldIcon from "../fields/FieldIcon";
import CategoryIcon from "./CategoryIcon";
import { NavLink, pageRoute } from "./nav";
import { formatDate, typeOf } from "./api";
import { t } from "../i18n";

/** Search: the words around the match, with the matched words marked. */
function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\u0002[^\u0003]*\u0003)/);
  return (
    <span className="page-card-lead">
      {parts.map((p, i) => (p.startsWith("\u0002") ? <mark key={i}>{p.slice(1, -1)}</mark> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </span>
  );
}

type Props = {
  pages: PageSummary[];
  types: PageType[];
  empty: string;
  /** Names each page's category on its card. */
  categories?: Category[];
  /** Show each page's space (search across spaces). */
  spaceNames?: Map<string, string>;
  /** Drafts list: open on the Edit tab. */
  drafts?: boolean;
};

/** Pages as cards: title, lead (or the search match), type, category, date. */
const PageList: React.FC<Props> = ({ pages, types, empty, categories, spaceNames, drafts }) => {
  if (!pages.length) return <p className="hint list-empty">{empty}</p>;
  return (
    <ul className="page-cards">
      {pages.map((p) => {
        const type = typeOf(types, p.typeId);
        const category = categories?.find((c) => c.id === p.categoryId);
        return (
          <li key={p.id}>
            <NavLink className="page-card" to={pageRoute(p.spaceId, p.id, drafts ? "edit" : undefined)}>
              <span className="page-card-title">{p.title || t("page.untitled")}</span>
              {p.snippet ? <Snippet text={p.snippet} /> : p.lead && <span className="page-card-lead">{p.lead}</span>}
              <span className="page-card-meta">
                {type && (
                  <span>
                    <FieldIcon name={type.icon} size={13} /> {type.name}
                  </span>
                )}
                {category && (
                  <span>
                    <CategoryIcon category={category} size={13} /> {category.name}
                  </span>
                )}
                {spaceNames?.get(p.spaceId) && <span>{spaceNames.get(p.spaceId)}</span>}
                {p.draftOnly ? <span className="page-card-draft">{t("page.neverPublished")}</span> : p.publishedAt > 0n && <span>{formatDate(p.publishedAt)}</span>}
              </span>
            </NavLink>
          </li>
        );
      })}
    </ul>
  );
};

export default PageList;
