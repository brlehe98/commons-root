import React from "react";
import { ChevronDown, Globe, Menu as MenuIcon, MoreHorizontal, Plus, Users } from "lucide-react";
import type { Space } from "@commons-root/gen-shared";
import Menu, { MenuItem } from "../ui/Menu";
import TabIcon from "../ui/TabIcon";
import SearchBox from "./SearchBox";
import { useNav } from "./nav";
import { t } from "../i18n";

/** A tool of the bar; its count (open reports) stays visible when only its icon shows. */
export type BarTool = MenuItem & { count?: number };

type Props = {
  space: Space;
  spaces: Space[];
  menuOpen: boolean;
  onMenu: () => void;
  /** Shown to those who write in the space. */
  onNewPage?: () => void;
  /** Reports, notifications, settings. */
  tools: BarTool[];
};

const spaceIcon = (s: Space) => <TabIcon icon={s.icon} color={s.color} size={16} fallback={s.main ? <Globe size={16} /> : <Users size={16} />} />;

/** The one bar at the top: main menu, space, search, new page and the app's tools. */
const TopBar: React.FC<Props> = ({ space, spaces, menuOpen, onMenu, onNewPage, tools }) => {
  const { go } = useNav();
  return (
    <header className="top-bar">
      <button className="bar-button menu-toggle" title={t("space.mainMenu")} aria-label={t("space.mainMenu")} aria-expanded={menuOpen} onClick={onMenu}>
        <MenuIcon size={18} />
      </button>
      {spaces.length > 1 ? (
        <Menu
          className="space-pick"
          title={t("space.choose")}
          trigger={
            <>
              {spaceIcon(space)}
              <span className="space-pick-name">{space.name}</span>
              <ChevronDown size={14} />
            </>
          }
          items={spaces.map((s) => ({ key: s.id, label: s.name, icon: spaceIcon(s), active: s.id === space.id, onSelect: () => go({ view: "space", spaceId: s.id }) }))}
        />
      ) : (
        <span className="space-pick single">
          {spaceIcon(space)}
          <span className="space-pick-name">{space.name}</span>
        </span>
      )}
      <SearchBox space={space} spaces={spaces} />
      {onNewPage && (
        <button className="bar-button bar-new" title={t("space.newPage")} onClick={onNewPage}>
          <Plus size={16} /> <span className="bar-label">{t("space.newPage")}</span>
        </button>
      )}
      <div className="bar-tools">
        {tools.map((x) => (
          <button key={x.key} className={x.active ? "bar-button on" : "bar-button"} title={x.label} onClick={x.onSelect}>
            {x.icon} <span className="bar-label">{x.label}</span>
            {!!x.count && <span className="bar-count">{x.count}</span>}
          </button>
        ))}
      </div>
      <Menu className="bar-more" align="right" title={t("app.more")} trigger={<MoreHorizontal size={18} />} items={tools} />
    </header>
  );
};

export default TopBar;
