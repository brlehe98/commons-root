import * as lucide from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Names saved before Lucide renamed an icon still work through its alias.
const iconFor = (name: string): LucideIcon | undefined =>
  name ? (lucide.icons[name as keyof typeof lucide.icons] ?? (lucide as unknown as Record<string, LucideIcon>)[name]) : undefined;

/** True when `name` is a Lucide icon we can draw. */
export const isIcon = (name: string) => !!iconFor(name);

/** A Lucide icon by its PascalCase name; nothing when the name is unknown. */
export default function FieldIcon({ name, color, size = 14 }: { name: string; color?: string; size?: number }) {
  const Icon = iconFor(name);
  return Icon ? <Icon size={size} color={color || "currentColor"} aria-hidden /> : null;
}

export const COLORS = ["#64748b", "#dc2626", "#ea580c", "#ca8a04", "#16a34a", "#0d9488", "#2563eb", "#7c3aed", "#db2777"];
