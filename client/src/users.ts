import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import { throttled } from "./rateLimit";
import { fixDevHostImageUrl } from "./devHost";

type Profile = { name: string; picture: string; color: string };
const profiles = new Map<string, Profile>();

export function colorForUser(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 42%)`;
}

export function cachedName(userId: string): string {
  return profiles.get(userId)?.name ?? "…";
}

/** The member's profile photo (small) and name color (their role's), when known. */
export function cachedProfile(userId: string): Profile | undefined {
  return profiles.get(userId);
}

/** Fetches names, photos and role colors for user ids not seen yet. */
export async function loadNames(userIds: string[]): Promise<void> {
  // Ids already being fetched are awaited, not asked again.
  const ids = Array.from(new Set(userIds)).filter((id) => id && !profiles.has(id));
  const missing = ids.filter((id) => !inFlight.has(id));
  if (missing.length) {
    const request = Promise.all([
      throttled(() => rootClient.users.getUserProfiles(missing)),
      // Loaded on first use, so the editor's tests need no wiki service.
      import("@commons-root/gen-client")
        .then(({ wikiServiceClient }) => throttled(() => wikiServiceClient.nameColors({ userIds: missing })))
        .catch(() => ({ colors: [] })),
    ]).then(([list, { colors }]) => {
      for (const p of list) {
        const picture = p.profilePictureUri ? fixDevHostImageUrl(rootClient.assets.toImageUrl(p.profilePictureUri, ImageUriResolution.Small)) : "";
        profiles.set(p.id, { name: p.nickname, picture, color: colors.find((c) => c.userId === p.id)?.color ?? "" });
      }
    });
    const done = request.finally(() => missing.forEach((id) => inFlight.delete(id)));
    missing.forEach((id) => inFlight.set(id, done));
  }
  await Promise.all(ids.map((id) => inFlight.get(id)).filter(Boolean));
}

const inFlight = new Map<string, Promise<void>>();
