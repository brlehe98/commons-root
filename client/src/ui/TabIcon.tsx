import React from "react";
import { rootClient, ImageUriResolution } from "@rootsdk/client-app";
import FieldIcon from "../fields/FieldIcon";
import { fixDevHostImageUrl } from "../devHost";

export const ASSET_PREFIX = "asset:";

/**
 * A tab's icon: a Lucide icon by name, or an uploaded image stored as
 * "asset:root://…". Shows `fallback` when there is none.
 */
const TabIcon: React.FC<{ icon: string; color?: string; size?: number; fallback?: React.ReactNode }> = ({
  icon,
  color,
  size = 16,
  fallback = null,
}) => {
  if (icon.startsWith(ASSET_PREFIX)) {
    const url = fixDevHostImageUrl(rootClient.assets.toImageUrl(icon.slice(ASSET_PREFIX.length), ImageUriResolution.Small));
    return <img className="tab-icon-image" src={url} width={size} height={size} style={{ width: size, height: size }} alt="" />;
  }
  if (!icon) return <span style={{ color: color || undefined, display: "inline-grid" }}>{fallback}</span>;
  return <FieldIcon name={icon} color={color} size={size} />;
};

export default TabIcon;
