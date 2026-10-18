import React, { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, MoreHorizontal } from "lucide-react";
import Menu from "./Menu";
import { t } from "../i18n";

export type NavItem = {
  key: string;
  label: string;
  icon: React.ReactNode;
  active?: boolean;
  /** A workspace's color, for its tab. */
  color?: string;
  /** The workspace whose board is (or was last) shown, even under a tool page. */
  current?: boolean;
  title?: string;
  onSelect: () => void;
};

type Props = { workspaces: NavItem[]; tools: NavItem[] };

// Room kept for the two menus and between the groups.
const MORE_WIDTH = 92;
// Below this width (a phone), one tab stands for the open workspace and opens the list.
const PHONE_WIDTH = 600;
const TOOLS_MENU_WIDTH = 52;
const GAP = 16;

const Tab: React.FC<{ item: NavItem; measure?: boolean }> = ({ item, measure }) => (
  <button
    className={(item.active ? "tab on" : "tab") + (item.color ? " colored" : "")}
    style={item.color ? ({ "--tab-color": item.color } as React.CSSProperties) : undefined}
    title={item.title}
    tabIndex={measure ? -1 : undefined}
    onClick={measure ? undefined : item.onSelect}
  >
    {item.icon}
    <span className="tab-label">{item.label}</span>
  </button>
);

const asMenu = (items: NavItem[]) => items.map((i) => ({ key: i.key, label: i.label, icon: i.icon, active: i.active, onSelect: i.onSelect }));

/**
 * The top bar: workspace tabs on the left, tools on the right. When they no
 * longer fit, the tools fold into one menu first, then the workspaces that
 * do not fit go into a "More" menu (the open one always stays in view);
 * no sideways scrolling.
 */
const TopNav: React.FC<Props> = ({ workspaces, tools }) => {
  const nav = useRef<HTMLElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<{ shown: number; toolsFolded: boolean; phone?: boolean }>({ shown: workspaces.length, toolsFolded: false });

  useLayoutEffect(() => {
    const el = nav.current;
    const ruler = measure.current;
    if (!el || !ruler) return;
    const compute = () => {
      const style = getComputedStyle(el);
      const width = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const widths = Array.from(ruler.children).map((c) => (c as HTMLElement).offsetWidth);
      const ws = widths.slice(0, workspaces.length);
      const tl = widths.slice(workspaces.length);
      const sum = (list: number[]) => list.reduce((a, b) => a + b + 2, 0);
      if (width < PHONE_WIDTH && workspaces.length > 1) return setLayout({ shown: 0, toolsFolded: true, phone: true });
      if (sum(ws) + sum(tl) + GAP <= width) return setLayout({ shown: workspaces.length, toolsFolded: false });
      const room = width - TOOLS_MENU_WIDTH - GAP;
      if (sum(ws) <= room) return setLayout({ shown: workspaces.length, toolsFolded: true });
      let shown = 0;
      let used = MORE_WIDTH;
      while (shown < ws.length && used + ws[shown] + 2 <= room) used += ws[shown++] + 2;
      setLayout({ shown, toolsFolded: true });
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, [workspaces.map((w) => w.key + w.label).join("|"), tools.map((w) => w.key + w.label).join("|")]);

  // The open workspace stays visible: it takes the last visible place if needed.
  let visible = workspaces.slice(0, layout.shown);
  const activeIndex = workspaces.findIndex((w) => w.active);
  if (activeIndex >= layout.shown && layout.shown > 0) visible = [...visible.slice(0, -1), workspaces[activeIndex]];
  const hidden = workspaces.filter((w) => !visible.includes(w));
  const toolActive = tools.some((i) => i.active);

  return (
    <nav className="tabs topnav" ref={nav}>
      {/* Every tab at its natural width, out of sight, to know what fits. */}
      <div className="topnav-measure" ref={measure} aria-hidden>
        {[...workspaces, ...tools].map((item) => (
          <Tab key={item.key} item={item} measure />
        ))}
      </div>
      {layout.phone && (
        <div className="topnav-group">
          <Menu
            className="topnav-more topnav-workspace"
            title={t("nav.moreWorkspaces")}
            trigger={(() => {
              const shown = workspaces.find((w) => w.current) ?? workspaces[0];
              return (
                <span
                  className={(shown.active ? "topnav-ws on" : "topnav-ws") + (shown.color ? " colored" : "")}
                  style={shown.color ? ({ "--tab-color": shown.color } as React.CSSProperties) : undefined}
                >
                  {shown.icon}
                  <span className="tab-label">{shown.label}</span>
                  <ChevronDown size={14} />
                </span>
              );
            })()}
            items={asMenu(workspaces)}
          />
        </div>
      )}
      {!layout.phone && workspaces.length > 0 && (
        <div className="topnav-group">
          {visible.map((item) => (
            <Tab key={item.key} item={item} />
          ))}
          {hidden.length > 0 && (
            <Menu
              className="topnav-more"
              title={t("nav.moreWorkspaces")}
              trigger={
                <>
                  <span className="tab-label">{t("nav.more", { count: hidden.length })}</span>
                  <ChevronDown size={14} />
                </>
              }
              items={asMenu(hidden)}
            />
          )}
        </div>
      )}
      <div className="spacer" />
      {layout.toolsFolded ? (
        <Menu
          className={toolActive ? "topnav-more topnav-tools-menu on" : "topnav-more topnav-tools-menu"}
          title={t("nav.tools")}
          align="right"
          trigger={<MoreHorizontal size={18} />}
          items={asMenu(tools)}
        />
      ) : (
        <div className="topnav-tools">
          {tools.map((item) => (
            <Tab key={item.key} item={item} />
          ))}
        </div>
      )}
    </nav>
  );
};

export default TopNav;
