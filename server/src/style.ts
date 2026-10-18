/** A Lucide icon name or "asset:root://..." for an uploaded image. */
export function cleanIcon(icon: string): string {
  const value = icon.trim();
  // Root asset URIs are opaque: accept any root:// URI without spaces or quotes.
  if (/^asset:root:\/\/[^\s"'<>\\]{1,400}$/.test(value)) return value;
  return /^[A-Za-z0-9]{0,64}$/.test(value) ? value : "";
}

/** A #rgb / #rrggbb color, or nothing. */
export function cleanColor(color: string): string {
  const value = color.trim();
  return /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : "";
}
