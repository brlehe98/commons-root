import { rootClient } from "@rootsdk/client-app";
import { throttled } from "./rateLimit";

const names = new Map<string, string>();

export function colorForUser(userId: string): string {
  let hash = 0;
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 70% 42%)`;
}

export function cachedName(userId: string): string {
  return names.get(userId) ?? "…";
}

/** Fetches display names for user ids not seen yet. */
export async function loadNames(userIds: string[]): Promise<void> {
  // Ids already being fetched are awaited, not asked again.
  const ids = Array.from(new Set(userIds)).filter((id) => id && !names.has(id));
  const missing = ids.filter((id) => !inFlight.has(id));
  if (missing.length) {
    const request = throttled(() => rootClient.users.getUserProfiles(missing)).then((profiles) => {
      for (const p of profiles) names.set(p.id, p.nickname);
    });
    const done = request.finally(() => missing.forEach((id) => inFlight.delete(id)));
    missing.forEach((id) => inFlight.set(id, done));
  }
  await Promise.all(ids.map((id) => inFlight.get(id)).filter(Boolean));
}

const inFlight = new Map<string, Promise<void>>();
