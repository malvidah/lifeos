"use client";
import { useRef, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * DraggableCard — wraps each card with two behaviours:
 *
 * NORMAL MODE  — 500ms long-press on any [data-card-header] element triggers
 *                layout edit mode. Normal taps pass through unaffected.
 *
 * EDIT MODE    — a small grip-dot handle appears on the left side of the card
 *                header. The whole header area becomes draggable via @dnd-kit.
 *                No rings, no remove buttons — the navbar dock handles add/remove.
 */
export function DraggableCard({ cardId, editMode, onEnterEditMode, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cardId, disabled: !editMode });

  // ── Long-press detection (normal mode only) ──────────────────────────────
  const timerRef    = useRef(null);
  const startPosRef = useRef(null);

  const startLongPress = useCallback((e) => {
    if (editMode) return;
    if (!e.target.closest("[data-card-header]")) return;
    startPosRef.current = { x: e.clientX, y: e.clientY };
    timerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      onEnterEditMode?.();
      startPosRef.current = null;
    }, 500);
  }, [editMode, onEnterEditMode]);

  const cancelLongPress = useCallback(() => {
    clearTimeout(timerRef.current);
    startPosRef.current = null;
  }, []);

  const moveLongPress = useCallback((e) => {
    if (!startPosRef.current) return;
    if (Math.abs(e.clientX - startPosRef.current.x) > 6 ||
        Math.abs(e.clientY - startPosRef.current.y) > 6) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        position: "relative",
        touchAction: editMode ? "none" : "pan-y",
        zIndex: isDragging ? 50 : "auto",
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerMove={moveLongPress}
    >
      {/* ── Edit mode: transparent drag zone over header + grip icon ── */}
      {editMode && (
        <div
          {...attributes}
          {...listeners}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 44,
            zIndex: 20,
            cursor: isDragging ? "grabbing" : "grab",
            display: "flex",
            alignItems: "center",
            paddingLeft: 14,
          }}
        >
          {/* Six-dot grip — matches the card's existing header muted color */}
          <svg
            width="10"
            height="14"
            viewBox="0 0 10 14"
            fill="var(--dl-highlight)"
            opacity="0.35"
            style={{ pointerEvents: "none", flexShrink: 0 }}
          >
            <circle cx="3" cy="2"  r="1.3" />
            <circle cx="7" cy="2"  r="1.3" />
            <circle cx="3" cy="7"  r="1.3" />
            <circle cx="7" cy="7"  r="1.3" />
            <circle cx="3" cy="12" r="1.3" />
            <circle cx="7" cy="12" r="1.3" />
          </svg>
        </div>
      )}

      {children}
    </div>
  );
}
