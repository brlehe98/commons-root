import React, { useState } from "react";
import { Category, PageType, Space } from "@commons-root/gen-shared";
import { LayoutGrid } from "lucide-react";
import PageList from "./PageList";
import { categoryOptions, useLoaded, wiki } from "./api";
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
    () =>
      wiki
        .listPages({
          spaceId: space.id,
          categoryId,
          deep: true,
          tag,
          typeId,
          drafts: false,
          recent,
          limit: 0,
        })
        .then((r) => r.pages),
    { spaceId: space.id },
  );
  const { value: tags = [] } = useLoaded(`tags:${space.id}`, () => wiki.listTags({ spaceId: space.id }).then((r) => r.tags), { spaceId: space.id });

  return (
    <div className="all-pages">
      <h1 className="page-title">
        <LayoutGrid size={24} /> {t("space.allPages")}
      </h1>
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
      {pages && <PageList pages={pages} types={types} categories={categories} empty={t("all.empty")} />}
    </div>
  );
};

export default AllPages;
