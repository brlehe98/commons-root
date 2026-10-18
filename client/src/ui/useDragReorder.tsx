import React, { useState } from "react";
import { GripVertical } from "lucide-react";
import { t } from "../i18n";

/** Moves the item at `from` so it ends up at index `to`. */
export const reorder = <T,>(list: T[], from: number, to: number): T[] => {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
};

/**
 * Drag-and-drop for a list that also has up/down buttons. Dragging starts from the grip only,
 * so inputs inside a row stay selectable. onMove gets the index dragged and its new index.
 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  // Where the dragged item would land: before the item at this index (length = at the end).
  const [target, setTarget] = useState<number | null>(null);

  const end = () => {
    setDragging(null);
    setTarget(null);
  };

  /** Props for a row; spread on the element that holds the grip. */
  const row = (i: number) => ({
    className: [dragging === i && "dragging", target === i && "drop-before", target === i + 1 && "drop-after"].filter(Boolean).join(" "),
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const box = e.currentTarget.getBoundingClientRect();
      setTarget(e.clientY < box.top + box.height / 2 ? i : i + 1);
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragging !== null && target !== null) {
        const to = target > dragging ? target - 1 : target;
        if (to !== dragging) onMove(dragging, to);
      }
      end();
    },
  });

  /** The grip that starts a drag; the whole row is shown as the drag image. */
  const grip = (i: number, label = t("common.dragToReorder")) => (
    <span
      className="drag-grip"
      title={label}
      aria-label={label}
      draggable
      onDragStart={(e) => {
        const rowEl = e.currentTarget.closest("[data-drag-row]") as HTMLElement | null;
        if (rowEl) e.dataTransfer.setDragImage(rowEl, 16, 16);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(i));
        setDragging(i);
      }}
      onDragEnd={end}
    >
      <GripVertical size={15} />
    </span>
  );

  return { row, grip };
}
