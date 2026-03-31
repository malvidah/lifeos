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
    // Only fire from the card label zone — NOT from headerRight controls
    if (!e.target.closest("[data-drag-zone]")) return;
    // Never fire on interactive elements — typing/tapping buttons must work normally.
    // Check both the direct target AND ancestors: clicks on SVG icons or spans
    // inside a button would otherwise pass the tagName check and start a long-press.
    if (INTERACTIVE.has(e.target.tagName)) return;
    if (e.target.closest('button, a, input, textarea, select, label, [role="button"], [role="switch"], [role="checkbox"], [role="tab"]')) return;
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
        // Only lock touch while actively dragging — lets page swipe work in edit mode
        touchAction: isDragging ? "none" : "pan-y",
        zIndex: isDragging ? 50 : undefined,
      }}
      onPointerDown={startLongPress}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerMove={moveLongPress}
    >
      {/* ── Edit mode: drag handle pill centered at top of card ── */}
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
            alignItems: "flex-start",
            justifyContent: "center",
            paddingTop: 7,
          }}
        >
          {/* Centered pill handle — like iOS modal drag indicator */}
          <div style={{
            width: 32,
            height: 4,
            borderRadius: 2,
            background: "var(--dl-border2)",
            opacity: 0.55,
            pointerEvents: "none",
            flexShrink: 0,
          }} />
        </div>
      )}

      {children}
    </div>
  );
}
