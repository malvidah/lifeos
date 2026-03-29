"use client";
import { useRef, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

/**
 * DraggableCard — wraps each card on a page with two behaviours:
 *
 * 1. NORMAL MODE  — intercepts a 500ms long-press on any [data-card-header]
 *    element inside the card to trigger layout edit mode. Normal taps/clicks
 *    pass through unaffected (we never call preventDefault on the pointer).
 *
 * 2. EDIT MODE    — renders a drag-handle overlay that covers the card header.
 *    The overlay carries @dnd-kit's listeners/attributes so the user can
 *    drag to reorder. A red "−" button lets them remove the card from the page.
 *    An accent ring highlights the card boundary.
 *
 * Props:
 *   cardId          string     unique card ID (used as dnd-kit sort ID)
 *   editMode        boolean
 *   onEnterEditMode () => void  called after 500ms long-press
 *   onRemove        () => void  called when the remove button is pressed
 *   children        ReactNode   the card's actual JSX
 */
export function DraggableCard({ cardId, editMode, onEnterEditMode, onRemove, children }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: cardId, disabled: !editMode });

  // ── Long-press detection (normal mode only) ──────────────────────────────
  const longPressTimer  = useRef(null);
  const longPressStart  = useRef(null);

  const startLongPress = useCallback((e) => {
    if (editMode) return;
    // Only trigger when the touch/click starts on the card header area
    if (!e.target.closest("[data-card-header]")) return;
    longPressStart.current = { x: e.clientX, y: e.clientY };
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      onEnterEditMode?.();
      longPressStart.current = null;
    }, 500);
  }, [editMode, onEnterEditMode]);

  const cancelLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
    longPressStart.current = null;
  }, []);

  const moveLongPress = useCallback((e) => {
    if (!longPressStart.current) return;
    const dx = Math.abs(e.clientX - longPressStart.current.x);
    const dy = Math.abs(e.clientY - longPressStart.current.y);
    // Cancel if the pointer drifted more than 6 px (scroll or swipe)
    if (dx > 6 || dy > 6) cancelLongPress();
  }, [cancelLongPress]);

  // ── Sortable transform style ─────────────────────────────────────────────
  const wrapperStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.45 : 1,
    position: "relative",
    // Disable native touch scroll while dragging so dnd-kit can own the gesture
    touchAction: editMode ? "none" : "pan-y",
    zIndex: isDragging ? 50 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={wrapperStyle}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerMove={moveLongPress}
    >
      {/* ── Edit-mode: drag handle overlay on card header ── */}
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
            justifyContent: "space-between",
            padding: "0 10px",
            borderRadius: "10px 10px 0 0",
            background: "rgba(0,0,0,0.04)",
            backdropFilter: "blur(4px)",
            WebkitBackdropFilter: "blur(4px)",
          }}
        >
          {/* Grip dots icon */}
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="var(--dl-middle)"
            style={{ flexShrink: 0, pointerEvents: "none" }}
          >
            <circle cx="5" cy="4"  r="1.2" />
            <circle cx="11" cy="4"  r="1.2" />
            <circle cx="5" cy="8"  r="1.2" />
            <circle cx="11" cy="8"  r="1.2" />
            <circle cx="5" cy="12" r="1.2" />
            <circle cx="11" cy="12" r="1.2" />
          </svg>

          {/* Remove card button */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onRemove?.(); }}
            aria-label="Remove card from page"
            style={{
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "var(--dl-red, #C0392B)",
              border: "none",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              lineHeight: 1,
              fontWeight: "bold",
              flexShrink: 0,
              paddingBottom: 1,
            }}
          >
            −
          </button>
        </div>
      )}

      {/* ── Edit-mode: accent ring around the entire card ── */}
      {editMode && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            zIndex: 19,
            borderRadius: 12,
            boxShadow: "0 0 0 2px var(--dl-accent)",
          }}
        />
      )}

      {children}
    </div>
  );
}
