"use client";
import { useRef, useCallback } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Interactive element tags that should never trigger the long-press edit mode.
// Typing in a task input, tapping a filter button, etc. must not fire it.
const INTERACTIVE = new Set(["INPUT", "TEXTAREA", "BUTTON", "SELECT", "A", "LABEL"]);

/**
 * DraggableCard — wraps each card with two behaviours:
 *
 * NORMAL MODE  — 500ms long-press on a [data-card-header] element (that is
 *                not an interactive control) triggers layout edit mode.
 *                Normal taps, scrolls, and input interactions pass through
 *                completely unaffected.
 *
 * EDIT MODE    — a small grip-dot handle appears over the card header and
 *                makes the whole header draggable via @dnd-kit.
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
    // Only fire from the card header zone
    if (!e.target.closest("[data-card-header]")) return;
    // Never fire on interactive elements — typing/tapping buttons must work normally
    if (INTERACTIVE.has(e.target.tagName)) return;
    if (e.target.isContentEditable) return;
    // Don't steal from ongoing text selection
    if (window.getSelection?.()?.type === "Range") return;

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
    // Cancel if pointer drifted — user is scrolling, not holding
    if (Math.abs(e.clientX - startPosRef.current.x) > 6 ||
        Math.abs(e.clientY - startPosRef.current.y) > 6) {
      cancelLongPress();
    }
  }, [cancelLongPress]);

  // ── Wrapper style ────────────────────────────────────────────────────────
  // CSS.Transform.toString(null) returns '' which, when set as style.transform,
  // still creates a new stacking context and causes layout shifts on first mount.
  // Convert falsy transform to undefined so React skips setting the attribute.
  const transformStr = CSS.Transform.toString(transform) || undefined;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transformStr,
        transition: transition || undefined,
        opacity: isDragging ? 0.4 : 1,
        position: "relative",
        // Let the page scroll naturally; only lock touch when in edit mode
        touchAction: editMode ? "none" : "pan-y",
        zIndex: isDragging ? 50 : undefined,
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
          {/* Six-dot grip — subtly matches the card's muted header color */}
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
