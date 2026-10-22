import React from "react";
import { ChevronRight, Home } from "lucide-react";
import type { Category, Space } from "@commons-root/gen-shared";
import { NavLink, SpaceAt } from "./nav";
import CategoryIcon from "./CategoryIcon";
import { t } from "../i18n";

export type Crumb = { label: React.ReactNode; at?: SpaceAt };

/** The categories leading to one, as crumbs. */
export const categoryCrumbs = (path: Category[]): Crumb[] =>
  path.map((c) => ({
    label: (
      <>
        <CategoryIcon category={c} size={14} /> {c.name}
      </>
    ),
    at: { kind: "category", categoryId: c.id },
  }));

/** The way back from a page: the space's home, then each step; the last one is where you are. */
const Crumbs: React.FC<{ space: Space; items: Crumb[] }> = ({ space, items }) => (
  <nav className="crumbs" aria-label={t("crumbs.label")}>
    <ol>
      <li>
        <NavLink to={{ view: "space", spaceId: space.id }}>
          <Home size={14} /> {t("space.home")}
        </NavLink>
      </li>
      {items.map((c, i) => (
        <li key={i}>
          <ChevronRight size={13} className="crumb-sep" aria-hidden />
          {c.at && i < items.length - 1 ? (
            <NavLink to={{ view: "space", spaceId: space.id, at: c.at }}>{c.label}</NavLink>
          ) : (
            <span aria-current={i === items.length - 1 ? "page" : undefined}>{c.label}</span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export default Crumbs;
