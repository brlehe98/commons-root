import React, { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useBackButton } from "../ui/backButton";
import { rootClient } from "@rootsdk/client-app";
import { figureImageUrl } from "../editor/figure";
import { t } from "../i18n";

/** A photo from Root's store; the second address is tried once when the first fails. */
export function StoredImage({ uri, ...rest }: { uri: string } & React.ImgHTMLAttributes<HTMLImageElement>) {
  return (
    <img
      {...rest}
      src={figureImageUrl(uri)}
      onError={(e) => {
        const img = e.currentTarget;
        if (img.dataset.triedFallback) return;
        img.dataset.triedFallback = "1";
        img.src = rootClient.assets.toUrl(uri);
      }}
    />
  );
}

/** A photo full size over the page, with its caption; Escape, a click or Back closes it. */
const Lightbox: React.FC<{ uri: string; caption: string; onClose: () => void }> = ({ uri, caption, onClose }) => {
  useBackButton(true, onClose);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div className="lightbox" role="dialog" aria-label={caption || t("read.photo")} onClick={onClose}>
      <button className="icon lightbox-close" title={t("common.close")} onClick={onClose}>
        <X size={20} />
      </button>
      <figure onClick={(e) => e.stopPropagation()}>
        <StoredImage uri={uri} alt={caption} />
        {caption && <figcaption>{caption}</figcaption>}
      </figure>
    </div>,
    document.body,
  );
};

export default Lightbox;
