import React, { useEffect, useMemo, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { searchIcons } from "../fields/iconSearch";
import { rootClient } from "@rootsdk/client-app";
import { docServiceClient } from "@commons-root/gen-client";
import FieldIcon, { COLORS } from "../fields/FieldIcon";
import TabIcon, { ASSET_PREFIX } from "./TabIcon";
import { t } from "../i18n";

// Enough to scroll through; a search narrows it.
const MAX_SHOWN = 300;

type Props = {
  icon: string;
  color: string;
  /** Shown in the button when no icon is chosen. */
  fallback: React.ReactNode;
  disabled?: boolean;
  /** Saves the style; a rejection is shown in the picker. */
  onChange: (style: { icon: string; color: string }) => Promise<unknown>;
};

/** Picks a tab's icon (searchable Lucide set or an uploaded PNG) and its color. */
const StylePicker: React.FC<Props> = ({ icon, color, fallback, disabled, onChange }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  // Shown at once; the saved value replaces it when the props change.
  const [shown, setShown] = useState({ icon, color });
  useEffect(() => setShown({ icon, color }), [icon, color]);
  const ref = useRef<HTMLDivElement>(null);

  const matches = useMemo(() => {
    return searchIcons(query).slice(0, MAX_SHOWN);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = async (style: { icon: string; color: string }) => {
    const before = shown;
    setShown(style);
    setStatus(null);
    try {
      await onChange(style);
    } catch (err) {
      setShown(before);
      setStatus(t("common.notSaved", { error: String((err as Error)?.message ?? err) }));
    }
  };

  const upload = async () => {
    try {
      setStatus(t("common.uploading"));
      const { tokens } = await rootClient.assets.fileUpload({ fileType: "imageAll", multiple: false, windowTitle: t("style.chooseImage") });
      if (!tokens?.length) return setStatus(null);
      const { uri } = await docServiceClient.commitPhoto({ token: tokens[0] });
      await pick({ icon: ASSET_PREFIX + uri, color: shown.color });
    } catch (err) {
      setStatus(t("common.uploadFailed", { error: String((err as Error)?.message ?? err) }));
    }
  };

  return (
    <div className="style-picker" ref={ref}>
      <button
        type="button"
        className="style-picker-button"
        disabled={disabled}
        title={disabled ? "" : t("style.iconAndColor")}
        onClick={() => setOpen(!open)}
      >
        <TabIcon icon={shown.icon} color={shown.color} fallback={fallback} />
      </button>
      {open && (
        <div className="style-picker-pop">
          <input autoFocus placeholder={t("style.searchIcons")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="icon-grid">
            <button type="button" title={t("style.defaultIcon")} className={!shown.icon ? "active" : ""} onClick={() => pick({ icon: "", color: shown.color })}>
              <span style={{ color: shown.color || undefined, display: "inline-grid" }}>{fallback}</span>
            </button>
            {matches.map((name) => (
              <button
                type="button"
                key={name}
                title={name}
                className={name === shown.icon ? "active" : ""}
                onClick={() => pick({ icon: name, color: shown.color })}
              >
                <FieldIcon name={name} color={shown.color} size={18} />
              </button>
            ))}
          </div>
          <div className="style-picker-row">
            <span className="hint">{t("style.color")}</span>
            <button type="button" className={!shown.color ? "swatch none active" : "swatch none"} title={t("style.defaultColor")} onClick={() => pick({ icon: shown.icon, color: "" })} />
            {COLORS.map((c) => (
              <button
                type="button"
                key={c}
                className={c === shown.color ? "swatch active" : "swatch"}
                style={{ background: c }}
                aria-label={c}
                onClick={() => pick({ icon: shown.icon, color: c })}
              />
            ))}
            <input type="color" value={shown.color || "#64748b"} onChange={(e) => pick({ icon: shown.icon, color: e.target.value })} title={t("style.otherColor")} />
          </div>
          {status && <p className="style-picker-status">{status}</p>}
          <div className="style-picker-row">
            <button type="button" className="with-icon" onClick={upload}>
              <Upload size={15} /> {t("style.uploadImage")}
            </button>
            
          </div>
        </div>
      )}
    </div>
  );
};

export default StylePicker;
