import { rootServer, UserGuid, CommunityRoleGuid, ReadOnlyMemberGroup, GlobalSettings, GlobalSettingsEvent } from "@rootsdk/server-app";
import { AccessLevel, Community } from "@commons-root/gen-shared";
import { all, get, marks } from "./db";

const ROLE_CACHE_MS = 30 * 1000;
const roleCache = new Map<string, { roles: string[]; expires: number }>();

export class AccessError extends Error {}

async function rolesOf(userId: UserGuid): Promise<string[]> {
  const cached = roleCache.get(userId);
  if (cached && cached.expires > Date.now()) return cached.roles;
  let communityRoleIds: string[];
  try {
    ({ communityRoleIds } = await rootServer.community.communityMemberRoles.list({ userId }));
  } catch (err) {
    // Root refuses for someone who is not a member, such as the dev host's
    // "Virtual User": treat them as having no role rather than failing
    // every request with "root-error".
    console.warn(`No community roles for ${userId}:`, (err as Error)?.message ?? err);
    communityRoleIds = [];
  }
  const now = Date.now();
  // Expired entries go once the cache grows, so it never holds every member ever seen.
  if (roleCache.size > 5000) for (const [k, v] of roleCache) if (v.expires <= now) roleCache.delete(k);
  roleCache.set(userId, { roles: communityRoleIds, expires: now + ROLE_CACHE_MS });
  return communityRoleIds;
}

// The settings as Root last sent them: the start-up copy can go stale once
// an admin changes them in Root, so each update replaces it.
let latestSettings: GlobalSettings | undefined;
let listening = false;
export function currentSettings(): GlobalSettings | undefined {
  if (!listening && rootServer.globalSettings) {
    listening = true;
    rootServer.globalSettings.on(GlobalSettingsEvent.Update, (event) => {
      latestSettings = event.current;
    });
  }
  return latestSettings ?? rootServer.globalSettings;
}

/** The "App admins" setting declared in root-manifest.json. */
function adminSetting(): ReadOnlyMemberGroup | undefined {
  return currentSettings()?.access?.appAdmins as ReadOnlyMemberGroup | undefined;
}

/** Roles named app admin in the app settings. */
export function adminRoleIds(): Set<string> {
  return new Set(adminSetting()?.communityRoleIds ?? []);
}

/** True while nobody is named app admin in the app settings. */
export function adminsUnset(): boolean {
  const group = adminSetting();
  // Any of the three lists says someone was chosen (Root fills them differently).
  return !group || (!group.userIds?.length && !group.communityRoleIds?.length && !group.memberUserIds?.length);
}

// The community's owner and the roles that run it (full control, or managing
// the community or its apps), re-read each minute.
let serverAdmins: { ownerId: string; roleIds: Set<string>; expires: number } | undefined;
async function serverAdminsNow() {
  if (serverAdmins && serverAdmins.expires > Date.now()) return serverAdmins;
  const [community, roles] = await Promise.all([rootServer.community.communities.get(), rootServer.community.communityRoles.list()]);
  serverAdmins = {
    ownerId: community.ownerUserId,
    roleIds: new Set(roles.filter(({ communityPermission: p }) => p.communityFullControl || p.communityManageCommunity || p.communityManageApps).map((r) => r.id)),
    expires: Date.now() + 60_000,
  };
  return serverAdmins;
}

/** Roles that run the Root community; their members are app admins. */
export async function serverAdminRoleIds(): Promise<Set<string>> {
  return (await serverAdminsNow().catch(() => undefined))?.roleIds ?? new Set();
}

/** The Root community's admins: its owner and the members of a role that runs it. */
export async function isServerAdmin(userId: UserGuid): Promise<boolean> {
  try {
    const admins = await serverAdminsNow();
    return admins.ownerId === userId || (await rolesOf(userId)).some((r) => admins.roleIds.has(r));
  } catch (err) {
    console.warn("Could not read the community's admins:", (err as Error)?.message ?? err);
    return false;
  }
}

/** Server admins always, plus whoever the "App admins" setting names. */
export async function isAppAdmin(userId: UserGuid): Promise<boolean> {
  if (await isServerAdmin(userId)) return true;
  return !adminsUnset() && adminSetting()!.isMember({ userId });
}

export type SpaceRow = {
  id: string;
  name: string;
  position: number;
  main: number;
  role_id: string;
  everyone_reads: number;
  icon: string;
  color: string;
  home: string;
  // Translations of the home page: { lang: widgets }.
  home_i18n: string;
};

export async function findSpace(id: string): Promise<SpaceRow> {
  const row = await get<SpaceRow>("SELECT * FROM spaces WHERE id = ?", [id]);
  if (!row) throw new Error("This space no longer exists.");
  return row;
}

/**
 * The member's level in a space: the highest of their roles, at least Read
 * when the space is open to everyone (the main space always is).
 */
export async function levelIn(userId: UserGuid, spaceId: string, space?: SpaceRow): Promise<AccessLevel> {
  if (await isAppAdmin(userId)) return AccessLevel.ADMIN;
  const row = space ?? (await get<SpaceRow>("SELECT * FROM spaces WHERE id = ?", [spaceId]));
  if (!row) return AccessLevel.INVISIBLE;
  const floor = row.main || row.everyone_reads ? AccessLevel.READ : AccessLevel.INVISIBLE;
  const roles = await rolesOf(userId);
  if (!roles.length) return floor;
  const found = await get<{ level: number | null }>(
    `SELECT MAX(level) AS level FROM space_access WHERE space_id = ? AND role_id IN (${marks(roles.length)})`,
    [spaceId, ...roles],
  );
  return Math.max(floor, found?.level ?? AccessLevel.INVISIBLE);
}

/** True when the member edits in at least one space. */
export async function editsSomewhere(userId: UserGuid): Promise<boolean> {
  if (await isAppAdmin(userId)) return true;
  const roles = await rolesOf(userId);
  if (!roles.length) return false;
  const row = await get<{ n: number }>(`SELECT COUNT(*) AS n FROM space_access WHERE level >= ? AND role_id IN (${marks(roles.length)})`, [
    AccessLevel.EDIT,
    ...roles,
  ]);
  return (row?.n ?? 0) > 0;
}

export async function requireLevel(userId: UserGuid, spaceId: string, min: AccessLevel): Promise<AccessLevel> {
  const level = await levelIn(userId, spaceId);
  if (level < min) throw new AccessError("You do not have access to do this.");
  return level;
}

export async function requireAdmin(userId: UserGuid) {
  if (!(await isAppAdmin(userId))) throw new AccessError("Only app admins can do this.");
}

export type PageAccess = {
  /** What the member may do in the draft: Read, Comment (suggest) or Edit. */
  level: AccessLevel;
  /** Editor of the space: publishes, changes settings, moves and deletes. */
  canPublish: boolean;
  spaceLevel: AccessLevel;
};

/**
 * A page's access: the space's editors write and publish; the page can open
 * its draft to suggestions or edits by everyone who reads the space.
 */
export async function pageAccess(userId: UserGuid, page: { space_id: string; community: number }): Promise<PageAccess> {
  const spaceLevel = await levelIn(userId, page.space_id);
  let level = Math.min(spaceLevel, AccessLevel.EDIT) as AccessLevel;
  if (spaceLevel >= AccessLevel.READ && level < AccessLevel.EDIT) {
    if (page.community === Community.SUGGEST) level = AccessLevel.COMMENT;
    if (page.community === Community.EDIT) level = AccessLevel.EDIT;
  }
  return { level, canPublish: spaceLevel >= AccessLevel.EDIT, spaceLevel };
}

/**
 * True when the member can see the page at all: its publication for
 * readers, the draft of a page never published only for those who write in it.
 */
export function canSeePage(access: PageAccess, page: { revision_id: number | null }): boolean {
  if (access.spaceLevel < AccessLevel.READ) return false;
  return page.revision_id != null || access.level >= AccessLevel.COMMENT;
}

/**
 * Keeps one Root member group per space with everyone who can read it, so
 * broadcasts about the space only reach them. Root updates the group
 * itself when members gain or lose a role.
 */
export async function syncSpaceGroup(spaceId: string) {
  const rows = await all<{ role_id: string }>("SELECT role_id FROM space_access WHERE space_id = ? AND level >= ?", [
    spaceId,
    AccessLevel.READ,
  ]);
  const admins = adminSetting();
  const server = await serverAdminsNow().catch(() => undefined);
  const roleIds = Array.from(new Set([...rows.map((r) => r.role_id), ...(admins?.communityRoleIds ?? []), ...(server?.roleIds ?? [])])) as CommunityRoleGuid[];
  const userIds = Array.from(new Set([...(admins?.userIds ?? []), ...(server ? [server.ownerId] : [])])) as UserGuid[];
  const query = { resourceType: "space", resourceId: spaceId, name: "readers" };
  const existing = await rootServer.memberGroups.getByName(query);
  if (existing) await existing.update({ userIds, communityRoleIds: roleIds });
  else await rootServer.memberGroups.create({ ...query, userIds, communityRoleIds: roleIds });
}

export async function deleteSpaceGroup(spaceId: string) {
  const existing = await rootServer.memberGroups.getByName({ resourceType: "space", resourceId: spaceId, name: "readers" });
  if (existing) await rootServer.memberGroups.delete(existing.id);
}

/** Broadcast target for a space: everyone when it is open, else its readers. */
export async function spaceAudience(spaceId: string) {
  const space = await get<SpaceRow>("SELECT * FROM spaces WHERE id = ?", [spaceId]);
  if (!space) return [];
  if (space.main || space.everyone_reads) return "all" as const;
  const query = { resourceType: "space", resourceId: spaceId, name: "readers" };
  let group = await rootServer.memberGroups.getByName(query);
  if (!group) {
    try {
      await syncSpaceGroup(spaceId);
      group = await rootServer.memberGroups.getByName(query);
    } catch (err) {
      console.warn(`Could not create the reader group of space ${spaceId}:`, (err as Error)?.message ?? err);
    }
  }
  // Fail closed: without the group, nobody gets the broadcast (clients
  // catch up when they reopen) rather than everyone.
  return group ? group.id : [];
}

export async function hasRole(userId: UserGuid, roleId: string): Promise<boolean> {
  return (await rolesOf(userId)).includes(roleId);
}

/** Every role of the member, for listing who edits a space. */
export { rolesOf };
