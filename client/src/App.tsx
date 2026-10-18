import React, { useCallback, useEffect, useState } from "react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { boardServiceClient, BoardServiceClientEvent } from "@commons-root/gen-client";
import { GetMeResponse, Workspace } from "@commons-root/gen-shared";
import { setImageUrlResolver } from "./editor/figure";
import { fixDevHostImageUrl } from "./devHost";
import TabIcon from "./ui/TabIcon";
import TopNav from "./ui/TopNav";
import Board from "./board/Board";
import AdminPanel from "./board/AdminPanel";
import { setStageColors } from "./board/stageColors";
import { Archive as ArchiveIcon, Bell, LayoutGrid, Newspaper, Plus, Settings } from "lucide-react";
import Archive from "./archive/Archive";
import Editorial from "./editorial/Editorial";
import { editorialServiceClient } from "@commons-root/gen-client";
import { NotifyPrefs } from "./notify/NotifySettings";
import { t } from "./i18n";
import { useBackButton } from "./ui/backButton";
import { readResume, saveResume } from "./ui/resume";
import { recall, remember } from "./snapshots";
import { useBusy } from "./ui/busy";

setImageUrlResolver(
  (uri) => fixDevHostImageUrl(rootClient.assets.toImageUrl(uri, ImageUriResolution.Original)),
  (uri) => rootClient.assets.toUrl(uri),
);
document.documentElement.dataset.theme = rootClient.theme.getTheme();
rootClient.theme.on("theme.update", (mode) => {
  document.documentElement.dataset.theme = mode;
});

const LAST_WORKSPACE_KEY = "commons.lastWorkspace";
function remembered(): string | null {
  try {
    return localStorage.getItem(LAST_WORKSPACE_KEY);
  } catch {
    return null;
  }
}

type AppCopy = { me: GetMeResponse; workspaces: Workspace[]; stageColors: Parameters<typeof setStageColors>[0] };

const App: React.FC = () => {
  // The last copy seen draws the app at once; the fresh one follows.
  const [saved] = useState(() => {
    const copy = recall<AppCopy>("app");
    if (copy) setStageColors(copy.stageColors);
    return copy;
  });
  const [me, setMe] = useState<GetMeResponse | null>(saved?.me ?? null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>(saved?.workspaces ?? []);
  const [fresh, setFresh] = useState(false);
  useBusy(!!me && !fresh);
  // Read before the board mounts: an empty board forgets the open project.
  const [resume] = useState(readResume);
  const [current, setCurrent] = useState<string | null>(() => {
    const p = resume?.projectId ? recall<{ project?: { workspaceId: string } }>(`project:${resume.projectId}`)?.project : undefined;
    return p?.workspaceId ?? remembered();
  });
  // Notifications open the app at "?project=<id>"; a trip out of the app reopens the last one.
  const [linked, setLinked] = useState<{ projectId: string; workspaceId: string } | null>(() =>
    resume?.projectId && current && !new URLSearchParams(window.location.search).get("project") ? { projectId: resume.projectId, workspaceId: current } : null,
  );
  const [showAdmin, setShowAdmin] = useState(false);
  const [showArchive, setShowArchive] = useState(false);
  const [showEditorial, setShowEditorial] = useState(false);
  // The editorial desk is for admins and the roles they chose.
  const [canSeeEditorial, setCanSeeEditorial] = useState(false);
  const [showPrefs, setShowPrefs] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Settings opens on this workspace after creating it from the empty board.
  const [adminView, setAdminView] = useState<string | undefined>(undefined);
  const refresh = useCallback(async () => {
    try {
      const [meResponse, list] = await Promise.all([boardServiceClient.getMe({}), boardServiceClient.listWorkspaces({})]);
      setMe(meResponse);
      setWorkspaces(list.workspaces);
      setStageColors(list.stageColors);
      setFresh(true);
      remember("app", { me: meResponse, workspaces: list.workspaces, stageColors: list.stageColors } satisfies AppCopy);
    } catch (err) {
      setError(String((err as Error)?.message ?? err));
    }
  }, []);

  useEffect(() => {
    // A notification link opens its project; otherwise, after a short trip
    // out of the app, the reader comes back where they were.
    const projectId = new URLSearchParams(window.location.search).get("project") ?? resume?.projectId;
    if (!projectId && resume?.view) {
      setShowEditorial(resume.view === "desk");
      setShowArchive(resume.view === "archive");
      setShowAdmin(resume.view === "settings");
    }
    if (!projectId) return;
    boardServiceClient
      .getProject({ id: projectId })
      .then((res) => {
        if (!res.project) return setLinked(null);
        setCurrent(res.project.workspaceId);
        setLinked({ projectId, workspaceId: res.project.workspaceId });
      })
      .catch((err) => {
        // Deleted, or no longer shared: the board instead.
        console.warn("Could not open the linked project", err);
        setLinked(null);
      });
  }, []);

  useEffect(() => {
    const check = () =>
      editorialServiceClient
        .getAccess()
        .then((r) => setCanSeeEditorial(r.canSee))
        .catch(() => setCanSeeEditorial(false));
    check();
    window.addEventListener("editorial-settings", check);
    return () => window.removeEventListener("editorial-settings", check);
  }, [me?.userId]);

  useEffect(() => {
    refresh();
    boardServiceClient.on(BoardServiceClientEvent.WorkspacesChanged, refresh);
    return () => {
      boardServiceClient.off(BoardServiceClientEvent.WorkspacesChanged, refresh);
    };
  }, [refresh]);

  const select = (id: string) => {
    setCurrent(id);
    setShowAdmin(false);
    setShowArchive(false);
    setShowEditorial(false);
    setLinked(null);
    try {
      localStorage.setItem(LAST_WORKSPACE_KEY, id);
    } catch {
      // Storage can be unavailable; the choice just isn't remembered.
    }
  };

  // First run: create a workspace, then open Settings on it to set it up.
  const createFirst = async () => {
    setCreating(true);
    setCreateError(null);
    try {
      const { workspace } = await boardServiceClient.saveWorkspace({ id: "", name: t("app.defaultWorkspace") });
      await refresh();
      if (workspace) setCurrent(workspace.id);
      setAdminView(workspace?.id);
      setShowArchive(false);
      setShowAdmin(true);
    } catch (err) {
      setCreateError(String((err as Error)?.message ?? err));
    } finally {
      setCreating(false);
    }
  };

  // The open workspace's color, as a light reminder across its board, project and windows.
  useEffect(() => {
    const open = workspaces.find((w) => w.id === current) ?? workspaces[0];
    const root = document.documentElement;
    if (open?.color && !showAdmin && !showArchive && !showEditorial) {
      root.style.setProperty("--ws-color", open.color);
      root.dataset.wsTint = "";
    } else {
      root.style.removeProperty("--ws-color");
      delete root.dataset.wsTint;
    }
  }, [workspaces, current, showAdmin, showArchive, showEditorial]);

  // Desk, Archive or Settings: remembered for a trip out of the app, and closed by the back button.
  const view = showEditorial ? "desk" : showArchive ? "archive" : showAdmin ? "settings" : undefined;
  useEffect(() => saveResume({ view }), [view]);
  useBackButton(!!view, () => {
    setShowEditorial(false);
    setShowArchive(false);
    setShowAdmin(false);
  });

  if (error) return <div className="app-message">{t("app.loadError", { error })}</div>;
  if (!me) return <div className="app-message">{t("app.loading")}</div>;

  const workspace = workspaces.find((w) => w.id === current) ?? workspaces[0];

  return (
    <div className="shell">
      <TopNav
        workspaces={workspaces.map((w) => ({
          key: w.id,
          label: w.name,
          color: w.color || undefined,
          icon: <TabIcon icon={w.icon} color={w.color} size={15} fallback={<LayoutGrid size={15} />} />,
          active: w.id === workspace?.id && !showAdmin && !showArchive && !showEditorial,
          current: w.id === workspace?.id,
          onSelect: () => select(w.id),
        }))}
        tools={[
          ...(canSeeEditorial ? [{ key: "desk", label: t("app.desk"), icon: <Newspaper size={15} />, active: showEditorial, onSelect: () => (setShowEditorial(true), setShowArchive(false), setShowAdmin(false)) }] : []),
          { key: "archive", label: t("app.archive"), icon: <ArchiveIcon size={15} />, active: showArchive, onSelect: () => (setShowArchive(true), setShowAdmin(false), setShowEditorial(false)) },
          { key: "notifications", label: t("app.notifications"), title: t("app.myNotifications"), icon: <Bell size={15} />, onSelect: () => setShowPrefs(true) },
          ...(me.isAdmin
            ? [{ key: "settings", label: t("app.settings"), icon: <Settings size={15} />, active: showAdmin, onSelect: () => (setAdminView(undefined), setShowAdmin(true), setShowArchive(false), setShowEditorial(false)) }]
            : []),
        ]}
      />
      {showPrefs && <NotifyPrefs onClose={() => setShowPrefs(false)} />}
      {me.adminsUnset && (
        <div className="banner">
          {t("app.adminsUnset")}
        </div>
      )}
      {showEditorial && canSeeEditorial ? (
        <Editorial />
      ) : showArchive ? (
        <Archive workspaces={workspaces} isAdmin={me.isAdmin} />
      ) : showAdmin ? (
        <AdminPanel key={adminView ?? "general"} workspaces={workspaces} onChanged={refresh} initialView={adminView} />
      ) : workspace ? (
        <Board
          key={`${workspace.id}/${linked?.projectId ?? ""}`}
          workspace={workspace}
          initialProjectId={linked?.workspaceId === workspace.id ? linked.projectId : undefined}
        />
      ) : (
        <div className="empty-state">
          <div className="empty-card">
            <span className="empty-icon">
              <LayoutGrid size={26} />
            </span>
            {me.isAdmin ? (
              <>
                <h2>{t("app.createFirstTitle")}</h2>
                <p>{t("app.createFirstText")}</p>
                <button className="primary" disabled={creating} onClick={createFirst}>
                  <Plus size={16} /> {creating ? t("app.creating") : t("app.createWorkspace")}
                </button>
                {createError && <p className="field-error">{createError}</p>}
              </>
            ) : (
              <>
                <h2>{t("app.noWorkspaceTitle")}</h2>
                <p>{t("app.noWorkspaceText")}</p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;
