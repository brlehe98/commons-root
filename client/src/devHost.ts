/**
 * Root's dev host builds image addresses as
 *   http://localhost:8081/asset?query=root://asset/ID&resolution=large
 * but its own server reads the resolution from inside the query value
 * ("root://asset/ID?resolution=large"), so every photo answers 404 and
 * shows as an empty frame. Rewrites that one shape; real Root addresses
 * pass through untouched.
 */
export function fixDevHostImageUrl(url: string): string {
  const match = /^(https?:\/\/[^/]+\/asset)\?query=([^&]+)&resolution=([a-z]+)$/i.exec(url);
  if (!match) return url;
  const [, base, uri, resolution] = match;
  return `${base}?query=${encodeURIComponent(`${decodeURIComponent(uri)}?resolution=${resolution}`)}`;
}
