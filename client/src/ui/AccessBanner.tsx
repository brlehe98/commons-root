import React from "react";
import { Eye, FilePenLine } from "lucide-react";
import { AccessLevel } from "@commons-root/gen-shared";
import { t } from "../i18n";

/**
 * Says up front what a member below Edit level can do in a workspace: read
 * only, or comment and suggest. Shown on the board and in each project, so
 * it is clear before anyone tries to move a card or change a text.
 */
const AccessBanner: React.FC<{ level: AccessLevel }> = ({ level }) => {
  if (level >= AccessLevel.EDIT) return null;
  const suggest = level >= AccessLevel.COMMENT;
  return (
    <div className={suggest ? "access-banner suggest" : "access-banner readonly"} role="note">
      {suggest ? <FilePenLine size={16} /> : <Eye size={16} />}
      <strong>{suggest ? t("access.suggestOnly") : t("editor.readOnly")}</strong>
    </div>
  );
};

export default AccessBanner;
