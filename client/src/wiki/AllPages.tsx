import React, { useState } from "react";
import { Category, PageType, Space } from "@commons-root/gen-shared";
import FieldIcon from "../fields/FieldIcon";
import { categoryOptions, formatDate, typeOf, useLoaded, wiki } from "./api";
import { NavLink, pageRoute } from "./nav";
import { t } from "../i18n";

type Props = { space: Space; types: PageType[]; categories: Category[] };

/** Every published page of the space as a card, narrowed by type, category and tag. */
const AllPages: React.FC<Props> = ({ space, types, categories }) => {
  const [typeId, setTypeId] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [tag, setTag] = useState("");
  const [recent, setRecent] = useState(false);
  const { value: pages } = useLoaded(
    `all:${space.id}:${typeId}:${categoryId}:${tag}:${recent}`,
    () => wiki.listPages({ spaceId: space.id, categoryId, deep: true, tag, typeId, drafts: false, recent, limit: 0 }).then((r) => r.pages),
    { spaceId: space.id },
  );
  const { value: tags = [] } = useLoaded(`tags:${space.id}`, () => wiki.listTags({ spaceId: space.id }).then((r) => r.tags), { spaceId: space.id });
  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name;

  return (
    <div className="all-pages">
      <h1 className="page-title">{t("space.allPages")}</h1>
      <div className="filters">
        <label>
          <span>{t("page.type")}</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)}>
            <option value="">{t("all.any")}</option>
            {types.map((tp) => (
              <option key={tp.id} value={tp.id}>
                {tp.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("page.category")}</span>
          <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
            {categoryOptions(categories, t("all.any")).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("space.tags")}</span>
          <select value={tag} onChange={(e) => setTag(e.target.value)}>
            <option value="">{t("all.any")}</option>
            {tags.map((x) => (
              <option key={x.tag} value={x.tag}>
                {x.tag}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t("all.sort")}</span>
          <select value={recent ? "recent" : "title"} onChange={(e) => setRecent(e.target.value === "recent")}>
            <option value="title">{t("all.byTitle")}</option>
            <option value="recent">{t("all.byDate")}</option>
          </select>
        </label>
      </div>
      {pages && !pages.length && <p className="hint list-empty">{t("all.empty")}</p>}
      <ul className="page-cards">
        {(pages ?? []).map((p) => {
          const type = typeOf(types, p.typeId);
          return (
            <li key={p.id}>
              <NavLink className="page-card" to={pageRoute(space.id, p.id)}>
                <span className="page-card-title">{p.title || t("page.untitled")}</span>
                {p.lead && <span className="page-card-lead">{p.lead}</span>}
                <span className="page-card-meta">
                  {type && (
                    <span>
                      <FieldIcon name={type.icon} size={13} /> {type.name}
                    </span>
                  )}
                  {categoryName(p.categoryId) && <span>{categoryName(p.categoryId)}</span>}
                  {p.publishedAt > 0n && <span>{formatDate(p.publishedAt)}</span>}
                </span>
              </NavLink>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default AllPages;
