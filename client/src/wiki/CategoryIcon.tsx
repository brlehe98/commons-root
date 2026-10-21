import React from "react";
import { Folder } from "lucide-react";
import type { Category } from "@commons-root/gen-shared";
import TabIcon from "../ui/TabIcon";

/** A category's icon in its color; a plain folder when it has none. */
const CategoryIcon: React.FC<{ category: Category; size?: number }> = ({ category, size = 15 }) => (
  <TabIcon icon={category.icon} color={category.color} size={size} fallback={<Folder size={size} />} />
);

export default CategoryIcon;
