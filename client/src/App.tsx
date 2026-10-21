import React, { useCallback, useEffect, useState } from "react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { WikiServiceClientEvent } from "@commons-root/gen-client";
import { AccessLevel, GetMeResponse, Space } from "@commons-root/gen-shared";
import { Bell, Flag, Settings as SettingsIcon } from "lucide-react";
import { setImageUrlResolver } from "./editor/figure";
import { setFileUrlResolver } from "./editor/attachment";
import { fixDevHostImageUrl } from "./devHost";
import { NotifyPrefs } from "./notify/NotifySettings";
import { t } from "./i18n";
import { readResume, saveResume } from "./ui/resume";
import { recall, remember } from "./snapshots";
import { useBusy } from "./ui/busy";
import { errorText, usePageTypes, wiki } from "./wiki/api";
import { NavProvider, pageRoute, Route, useNav } from "./wiki/nav";
import type { BarTool } from "./wiki/TopBar";
import SpaceView from "./wiki/SpaceView";
import Reports from "./wiki/Reports";
import Settings from "./wiki/Settings";

setImageUrlResolver(
  (uri) => fixDevHostImageUrl(rootClient.assets.toImageUrl(uri, ImageUriResolution.Original)),
  (uri) => rootClient.assets.toUrl(uri),
);
setFileUrlResolver((uri) => rootClient.assets.toUrl(uri));
document.documentElement.dataset.theme = rootClient.theme.getTheme();
rootClient.theme.on("theme.update", (mode) => {
  document.documentElement.dataset.theme = mode;
});

type AppCopy = { me: GetMeResponse; spaces: Space[] };

const App: React.FC = () => {
  // The last copy seen draws the app at once; the fresh one follows.
  const [saved] = useState(() => recall<AppCopy>("app"));
  const [me, setMe] = useState<GetMeResponse | null>(saved?.me ?? null);
  const [spaces, setSpaces] = useState<Space[]>(saved?.spaces ?? []);
  const [fresh, setFresh] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useBusy(!!me && !fresh);

  const refresh = useCallback(async () => {
    try {
      const [meResponse, list] = await Promise.all([wiki.getMe(), wiki.listSpaces()]);
      setMe(meResponse);
      setSpaces(list.spaces);
      setFresh(true);
      remember("app", { me: meResponse, spaces: list.spaces } satisfies AppCopy);
    } catch (err) {
      setError(errorText(err));
    }
  }, []);

  useEffect(() => {
    refresh();
    wiki.on(WikiServiceClientEvent.SpacesChanged, refresh);
    return () => {
      wiki.off(WikiServiceClientEvent.SpacesChanged, refresh);
    };
  }, [refresh]);

  if (error && !me) return <div className="app-message">{t("app.loadError", { error })}</div>;
  if (!me || !spaces.length) return <div className="app-message">{t("app.loading")}</div>;

  const main = spaces.find((s) => s.main) ?? spaces[0];
  // A short trip out of the app comes back to the same place.
  const resumed = readResume()?.route as Route | undefined;
  const initial: Route = resumed && (resumed.view !== "space" || spaces.some((s) => s.id === resumed.spaceId)) ? resumed : { view: "space", spaceId: main.id };

  return (
    <NavProvider initial={initial}>
      <Shell me={me} spaces={spaces} onChanged={refresh} />
    </NavProvider>
  );
};

const Shell: React.FC<{ me: GetMeResponse; spaces: Space[]; onChanged: () => void }> = ({ me, spaces, onChanged }) => {
  const { route, go } = useNav();
  const { types } = usePageTypes();
  const [showPrefs, setShowPrefs] = useState(false);
  const main = spaces.find((s) => s.main) ?? spaces[0];
  const writes = spaces.some((s) => s.level >= AccessLevel.EDIT);

  // Notifications open the app at "?page=<id>".
  useEffect(() => {
    const pageId = new URLSearchParams(window.location.search).get("page");
    if (!pageId) return;
    wiki
      .getPage({ id: pageId })
      .then((r) => r.page && go(pageRoute(r.page.spaceId, r.page.id)))
      .catch((err) => console.warn("Could not open the linked page", err));
  }, []);

  useEffect(() => saveResume({ route }), [JSON.stringify(route)]);

  // Every view shows inside a space, under the one bar, with its main menu.
  const space = (route.view === "space" || route.view === "search" ? spaces.find((s) => s.id === route.spaceId) : undefined) ?? main;

  // The open space's color, as a light reminder across its pages.
  useEffect(() => {
    const root = document.documentElement;
    if (space.color) {
      root.style.setProperty("--ws-color", space.color);
      root.dataset.wsTint = "";
    } else {
      root.style.removeProperty("--ws-color");
      delete root.dataset.wsTint;
    }
  }, [space.id, space.color]);

  // The bar's tools, at its right end.
  const tools: BarTool[] = [
    ...(writes
      ? [
          {
            key: "reports",
            label: me.openReports ? t("app.reportsCount", { count: me.openReports }) : t("app.reports"),
            count: me.openReports,
            icon: <Flag size={16} />,
            active: route.view === "reports",
            onSelect: () => go({ view: "reports" }),
          },
        ]
      : []),
    { key: "notifications", label: t("app.notifications"), icon: <Bell size={16} />, onSelect: () => setShowPrefs(true) },
    ...(me.isAdmin
      ? [{ key: "settings", label: t("app.settings"), icon: <SettingsIcon size={16} />, active: route.view === "settings", onSelect: () => go({ view: "settings" }) }]
      : []),
  ];

  let content: React.ReactNode = undefined;
  if (route.view === "reports") content = <Reports spaces={spaces} pageId={route.pageId} onChanged={onChanged} />;
  else if (route.view === "settings" && me.isAdmin) content = <Settings spaces={spaces} section={route.section} onChanged={onChanged} />;

  return (
    <div className="shell">
      {showPrefs && <NotifyPrefs onClose={() => setShowPrefs(false)} />}
      <SpaceView
        key={space.id}
        space={space}
        spaces={spaces}
        types={types}
        tools={tools}
        at={route.view === "space" && route.spaceId === space.id ? (route.at ?? { kind: "home" }) : { kind: "home" }}
        search={route.view === "search" ? { query: route.query, spaceId: route.spaceId } : undefined}
        content={content}
      />
    </div>
  );
};

export default App;
