import React, { useMemo, useState } from "react";
import { Shapes } from "lucide-react";
import { searchIcons } from "./iconSearch";
import FieldIcon, { isIcon } from "./FieldIcon";
import { t } from "../i18n";

// Enough to scroll through; a search narrows it.
const MAX_SHOWN = 300;

/** Searches Lucide icons by keyword ("check", "flag", "translate"). */
export default function IconPicker({
  value,
  color,
  onChange,
  placeholder,
  disabled,
}: {
  value: string;
  color: string;
  onChange: (name: string) => void;
  /** Shown when no icon is chosen; a grey shapes icon by default. */
  placeholder?: React.ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const matches = useMemo(() => {
    return searchIcons(query).slice(0, MAX_SHOWN);
  }, [query]);

  return (
    <div className="icon-picker">
      <button type="button" className="icon-picker-button" disabled={disabled} onClick={() => setOpen(!open)} title={disabled ? "" : t("style.chooseIcon")}>
        {isIcon(value) ? <FieldIcon name={value} color={color} size={16} /> : placeholder ?? <Shapes size={16} className="icon-empty" aria-label={t("style.icon")} />}
      </button>
      {open && (
        <div className="icon-picker-pop">
          <input autoFocus placeholder={t("style.searchIcons")} value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="icon-grid">
            <button type="button" title={t("style.noIcon")} onClick={() => (onChange(""), setOpen(false))}>
              ∅
            </button>
            {matches.map((name) => (
              <button
                type="button"
                key={name}
                title={name}
                className={name === value ? "active" : ""}
                onClick={() => (onChange(name), setOpen(false))}
              >
                <FieldIcon name={name} size={18} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function ColorPicker({ value, onChange, colors }: { value: string; onChange: (c: string) => void; colors: string[] }) {
  return (
    <div className="color-picker">
      {colors.map((c) => (
        <button
          type="button"
          key={c}
          className={c === value ? "swatch active" : "swatch"}
          style={{ background: c }}
          onClick={() => onChange(c)}
          aria-label={c}
        />
      ))}
      <input type="color" value={value || "#64748b"} onChange={(e) => onChange(e.target.value)} title={t("style.otherColor")} />
    </div>
  );
}

/** One round swatch that opens the palette: for long lists, like a field's options. */
export function CompactColorPicker({ value, fallback, onChange, colors }: { value: string; fallback: string; onChange: (c: string) => void; colors: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="compact-color">
      <button
        type="button"
        className={value ? "swatch" : "swatch inherit"}
        style={{ background: value || fallback }}
        title={value ? t("style.color") : t("style.sameAsField")}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="compact-color-pop" onMouseLeave={() => setOpen(false)}>
          <button type="button" className={!value ? "swatch none active" : "swatch none"} title={t("style.sameAsField")} onClick={() => (onChange(""), setOpen(false))} />
          <ColorPicker value={value} colors={colors} onChange={(c) => (onChange(c), setOpen(false))} />
        </div>
      )}
    </div>
  );
}
