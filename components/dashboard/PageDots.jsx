"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { mono, F } from "@/lib/tokens";

/**
 * PageDots — page navigation pill.
 *
 * Dots pill:
 *   • Tap a dot            → navigate to that page
 *   • Drag a dot L/R <40px → reorder pages (dots animate to new positions live)
 *   • Swipe pill L/R ≥40px → prev / next page (works anywhere including on dots)
 *   • Long-press dot 480ms → open compact glass popover (rename / delete)
 *   • "+"                  → add page
 *
 * All gesture detection is handled at the pill div level with setPointerCapture
 * so swipe is always reliable regardless of which child the pointer starts on.
 *
 * Home page dot shows a solid filled house icon (no door) in both selected and
 * unselected states.
 *
 * Popover — compact glass pill, same visual language as nav:
 *   🏠 · [editable name] · 🗑 · ✕
 *   Trash requires two taps to confirm deletion.
 */
export default function PageDots({
  count, active, homeIdx = 1, pages = [],
  onDotClick, onSwipePrev, onSwipeNext, onCycleNext,
  onAddPage, onRenamePage, onDeletePage,
  onReorderPages,
}) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [addingPage,  setAddingPage]  = useState(false);
  const [newPageName, setNewPageName] = useState("");
  const [menuPage,    setMenuPage]    = useState(null);
  const [nameEditing, setNameEditing] = useState(false);
  const [nameValue,   setNameValue]   = useState("");
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [dragTo,      setDragTo]      = useState(null); // { fromIdx, toIdx } while dragging

  const longPressTimer = useRef(null);
  const addInputRef    = useRef(null);
  const nameInputRef   = useRef(null);
  const deleteTimer    = useRef(null);
  const pillRef        = useRef(null);

  // Unified gesture ref — set on pointerdown, cleared on pointerup/cancel.
  // { startX, dx, dotIdx: number|null }
  const gestureRef  = useRef(null);
  // Suppress onClick on a dot button after a drag (any |dx|>10) has been handled.
  const dragWasRef  = useRef(false);

  // DOT_SPACING: approximate px between adjacent dot centres (dot width + gap).
  // Used to map horizontal drag distance → index offset.
  const DOT_SPACING = 15;

  // ── Long-press on dot ─────────────────────────────────────────────────────
  const startDotLongPress = useCallback((i) => {
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(20);
      setMenuPage(i);
      setNameValue(pages[i]?.name ?? "");
      setNameEditing(false);
      setDeleteArmed(false);
    }, 480);
  }, [pages]);

  const cancelDotLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);

  // ── Unified pill-level gesture handlers ────────────────────────────────────
  // All swipe / drag / tap detection lives here so that:
  //   a) Swipe works even when the gesture starts on a dot button, and
  //   b) Drag-to-reorder works without needing setPointerCapture on the button.
  //
  // The pill div calls setPointerCapture on itself so it reliably receives
  // move and up events even when the pointer leaves its bounds.

  const onPillPointerDown = useCallback((e) => {
    // Let text inputs handle their own events
    if (e.target.closest("input")) return;
    // Only primary pointer button (ignore right-click on mouse)
    if (e.pointerType === "mouse" && e.button !== 0) return;

    // Prevent browser's native long-press behaviour (text selection, context menu)
    e.preventDefault();

    // Capture pointer to pill so move/up are always received
    pillRef.current?.setPointerCapture(e.pointerId);

    // Detect which dot (if any) the gesture started on
    const btn    = e.target.closest("[data-dot-idx]");
    const dotIdx = btn ? parseInt(btn.dataset.dotIdx, 10) : null;

    gestureRef.current = { startX: e.clientX, dx: 0, dotIdx };
    dragWasRef.current = false;

    if (dotIdx !== null) startDotLongPress(dotIdx);
  }, [startDotLongPress]);

  const onPillPointerMove = useCallback((e) => {
    if (!gestureRef.current) return;
    const dx = e.clientX - gestureRef.current.startX;
    gestureRef.current.dx = dx;

    if (Math.abs(dx) > 10) {
      cancelDotLongPress();
      // If gesture started on a dot, show live drag-to-reorder preview
      const { dotIdx } = gestureRef.current;
      if (dotIdx !== null) {
        const offset = Math.round(dx / DOT_SPACING);
        const toIdx  = Math.max(0, Math.min(count - 1, dotIdx + offset));
        setDragTo(prev =>
          (prev?.fromIdx === dotIdx && prev?.toIdx === toIdx) ? prev : { fromIdx: dotIdx, toIdx }
        );
      }
    }
  }, [cancelDotLongPress, count]);

  const onPillPointerUp = useCallback((e) => {
    if (!gestureRef.current) return;
    const { dx, dotIdx } = gestureRef.current;
    gestureRef.current = null;
    setDragTo(null);
    cancelDotLongPress();

    // If the long-press menu opened, don't fire any navigation/reorder
    if (menuPage !== null) return;

    if (Math.abs(dx) <= 10) {
      // ── Tap anywhere on pill → cycle to next page (wraps around) ────────
      dragWasRef.current = true; // suppress upcoming click event
      onCycleNext?.();
      return;
    }

    // Any movement > 10px = drag; suppress the upcoming click on the button
    dragWasRef.current = true;

    if (Math.abs(dx) >= 40) {
      // ── Large swipe (anywhere on pill, including on dots) → page nav ────
      if (dx < 0) onSwipeNext?.();
      else         onSwipePrev?.();
    } else if (dotIdx !== null) {
      // ── Small drag on a dot (10–39px) → reorder pages ───────────────────
      const offset = Math.round(dx / DOT_SPACING);
      const toIdx  = Math.max(0, Math.min(count - 1, dotIdx + offset));
      if (dotIdx !== toIdx) onReorderPages?.(dotIdx, toIdx);
    }
  }, [menuPage, cancelDotLongPress, count, onDotClick, onReorderPages, onSwipePrev, onSwipeNext]);

  const onPillPointerCancel = useCallback(() => {
    gestureRef.current = null;
    setDragTo(null);
    cancelDotLongPress();
  }, [cancelDotLongPress]);

  // ── Focus inputs when they appear ─────────────────────────────────────────
  useEffect(() => {
    if (addingPage) {
      setNewPageName("");
      setTimeout(() => addInputRef.current?.focus(), 40);
    }
  }, [addingPage]);

  useEffect(() => {
    if (nameEditing) setTimeout(() => nameInputRef.current?.focus(), 20);
  }, [nameEditing]);

  // ── Popover helpers ────────────────────────────────────────────────────────
  const closeMenu = useCallback(() => {
    setMenuPage(null);
    setNameEditing(false);
    setDeleteArmed(false);
    clearTimeout(deleteTimer.current);
  }, []);

  const commitRename = useCallback(() => {
    const trimmed = nameValue.trim();
    if (trimmed && menuPage !== null && trimmed !== (pages[menuPage]?.name ?? "")) {
      onRenamePage?.(menuPage, trimmed);
    }
    setNameEditing(false);
  }, [nameValue, menuPage, pages, onRenamePage]);

  const handleTrash = useCallback(() => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      deleteTimer.current = setTimeout(() => setDeleteArmed(false), 2000);
    } else {
      clearTimeout(deleteTimer.current);
      if (menuPage !== null) onDeletePage?.(menuPage);
      closeMenu();
    }
  }, [deleteArmed, menuPage, onDeletePage, closeMenu]);

  // ── Add page ──────────────────────────────────────────────────────────────
  const confirmAddPage = useCallback(() => {
    const name = newPageName.trim() || "New Page";
    onAddPage?.(name);
    setAddingPage(false);
    setNewPageName("");
  }, [newPageName, onAddPage]);

  // ── Glass style (matches nav pills) ──────────────────────────────────────
  const glass = {
    background:           "var(--dl-glass)",
    backdropFilter:       "blur(16px) saturate(1.3)",
    WebkitBackdropFilter: "blur(16px) saturate(1.3)",
    border:               "1px solid var(--dl-glass-border)",
    boxShadow:            "var(--dl-glass-shadow)",
  };

  const ghostBtn = (extra = {}) => ({
    background: "none", border: "none", cursor: "pointer",
    color: "var(--dl-middle)", padding: "0 4px",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, opacity: 0.55, borderRadius: 4, fontSize: 13,
    transition: "opacity 0.15s, color 0.15s",
    ...extra,
  });

  const isHome = (i) => i === homeIdx;

  // Rounded filled house without a door — simple two-element shape.
  // Roof: flat-bottomed triangle. Body: rounded rect. No door cutout.
  const HouseIcon = ({ size = 11, color = "currentColor", style: s = {} }) => (
    <svg
      width={size} height={size}
      viewBox="0 0 24 24"
      style={{ display: "block", flexShrink: 0, ...s }}
    >
      {/* Roof */}
      <polygon points="12,2 1,13 23,13" fill={color} />
      {/* Body — rounded bottom corners, no door */}
      <rect x="4" y="12" width="16" height="10" rx="2.5" fill={color} />
    </svg>
  );

  // Compute visual order of dots during drag-to-reorder
  const displayOrder = (() => {
    const order = Array.from({ length: count }, (_, i) => i);
    if (dragTo && dragTo.fromIdx !== dragTo.toIdx) {
      const { fromIdx, toIdx } = dragTo;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, fromIdx);
    }
    return order;
  })();

  return (
    <div style={{ position: "relative", flexShrink: 0, pointerEvents: "auto" }}>

      {/* ── Popover (long-press) ────────────────────────────────────────────── */}
      {menuPage !== null && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={closeMenu} />

          <div style={{
            ...glass,
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            borderRadius: 100,
            zIndex: 50,
            display: "flex", alignItems: "center",
            height: 40, padding: "0 6px 0 14px", gap: 2,
            whiteSpace: "nowrap",
          }}>
            {/* House icon — home page indicator */}
            {isHome(menuPage) && (
              <HouseIcon size={12} color="var(--dl-accent)" style={{ opacity: 0.8, marginRight: 2 }} />
            )}

            {/* Reorder arrows */}
            <button
              onClick={() => {
                if (menuPage > 0) {
                  onReorderPages?.(menuPage, menuPage - 1);
                  setMenuPage(menuPage - 1);
                }
              }}
              disabled={menuPage === 0}
              title="Move page left"
              style={{
                ...ghostBtn(),
                opacity: menuPage === 0 ? 0.2 : 0.55,
                cursor: menuPage === 0 ? "default" : "pointer",
                padding: "0 2px",
              }}
              onMouseEnter={(e) => { if (menuPage > 0) e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = menuPage === 0 ? "0.2" : "0.55"; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
            <button
              onClick={() => {
                if (menuPage < count - 1) {
                  onReorderPages?.(menuPage, menuPage + 1);
                  setMenuPage(menuPage + 1);
                }
              }}
              disabled={menuPage === count - 1}
              title="Move page right"
              style={{
                ...ghostBtn(),
                opacity: menuPage === count - 1 ? 0.2 : 0.55,
                cursor: menuPage === count - 1 ? "default" : "pointer",
                padding: "0 2px",
              }}
              onMouseEnter={(e) => { if (menuPage < count - 1) e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = menuPage === count - 1 ? "0.2" : "0.55"; }}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>

            {/* Divider */}
            <div style={{ width: 1, height: 14, background: "var(--dl-glass-border)", margin: "0 2px", flexShrink: 0 }} />

            {/* Page name — click to edit inline */}
            {nameEditing ? (
              <input
                ref={nameInputRef}
                value={nameValue}
                onChange={(e) => setNameValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") { setNameEditing(false); setNameValue(pages[menuPage]?.name ?? ""); }
                }}
                style={{
                  background: "transparent", border: "none", outline: "none",
                  color: "var(--dl-strong)", fontFamily: mono, fontSize: F.sm,
                  width: Math.max(60, nameValue.length * 8.5), padding: 0,
                }}
              />
            ) : (
              <span
                onClick={() => { setNameEditing(true); setNameValue(pages[menuPage]?.name ?? ""); }}
                title="Click to rename"
                style={{
                  fontFamily: mono, fontSize: F.sm, color: "var(--dl-strong)",
                  cursor: "text", padding: "0 4px", userSelect: "none",
                  letterSpacing: "0.04em",
                }}
              >
                {pages[menuPage]?.name ?? `Page ${menuPage + 1}`}
              </span>
            )}

            {/* Divider */}
            <div style={{ width: 1, height: 14, background: "var(--dl-glass-border)", margin: "0 5px", flexShrink: 0 }} />

            {/* Trash — two-tap confirm */}
            {count > 1 && (
              <button
                onClick={handleTrash}
                title={deleteArmed ? "Tap again to delete" : "Delete page"}
                style={{
                  ...ghostBtn(),
                  opacity: deleteArmed ? 1 : 0.45,
                  color: deleteArmed ? "var(--dl-red, #C0392B)" : "var(--dl-middle)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = deleteArmed ? "1" : "0.45"; }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
              </button>
            )}

            {/* Close */}
            <button
              onClick={closeMenu}
              title="Close"
              style={{ ...ghostBtn(), fontSize: 12, padding: "0 8px 0 4px" }}
              onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.55"; }}
            >✕</button>
          </div>
        </>
      )}

      {/* ── Add-page input pill ────────────────────────────────────────────── */}
      {addingPage ? (
        <div style={{
          ...glass, borderRadius: 100, height: 40,
          display: "flex", alignItems: "center",
          padding: "0 8px 0 16px", gap: 6, minWidth: 180,
        }}>
          <input
            ref={addInputRef}
            value={newPageName}
            onChange={(e) => setNewPageName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")  confirmAddPage();
              if (e.key === "Escape") setAddingPage(false);
            }}
            placeholder="Page name…"
            style={{
              flex: 1, background: "transparent", border: "none", outline: "none",
              color: "var(--dl-strong)", fontFamily: mono, fontSize: F.sm,
              padding: 0, minWidth: 0,
            }}
          />
          <button onClick={confirmAddPage} style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "var(--dl-accent)", border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
          }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
          <button onClick={() => setAddingPage(false)} style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "color-mix(in srgb, var(--dl-strong) 10%, transparent)",
            border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            color: "var(--dl-middle)",
          }}>
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

      ) : (

      // ── Dots pill ──────────────────────────────────────────────────────────
      // All pointer gesture handling is at this level (not on individual buttons)
      // so that swipe navigation always works, even when started on a dot.
      <div
        ref={pillRef}
        style={{
          ...glass, borderRadius: 100, height: 40,
          display: "flex", alignItems: "center",
          justifyContent: "center", gap: 7,
          padding: "0 14px", userSelect: "none",
          touchAction: "none",
        }}
        onPointerDown={onPillPointerDown}
        onPointerMove={onPillPointerMove}
        onPointerUp={onPillPointerUp}
        onPointerCancel={onPillPointerCancel}
      >
        {displayOrder.map((pageIdx) => {
          const home      = isHome(pageIdx);
          const isActive  = pageIdx === active;
          const isDragging = dragTo?.fromIdx === pageIdx;

          if (home) {
            // Home dot — bare house icon, no pill wrapper
            return (
              <button
                key={pageIdx}
                data-dot-idx={pageIdx}
                title={pages[pageIdx]?.name ?? `Page ${pageIdx + 1}`}
                onClick={() => {
                  // onClick fires for keyboard users; pointer users are handled in onPillPointerUp
                  if (dragWasRef.current) { dragWasRef.current = false; return; }
                  onDotClick?.(pageIdx);
                }}
                style={{
                  background: "none", border: "none", padding: 0,
                  cursor: "pointer", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: isDragging ? 0.35 : 1,
                  transition: "opacity 0.15s",
                  touchAction: "none",
                }}
              >
                <HouseIcon
                  size={11}
                  color={isActive ? "var(--dl-strong)" : "var(--dl-border2)"}
                />
              </button>
            );
          }

          // Regular dot
          return (
            <button
              key={pageIdx}
              data-dot-idx={pageIdx}
              title={pages[pageIdx]?.name ?? `Page ${pageIdx + 1}`}
              onClick={() => {
                if (dragWasRef.current) { dragWasRef.current = false; return; }
                onDotClick?.(pageIdx);
              }}
              style={{
                width:        6,
                height:       6,
                borderRadius: 3,
                background:   isActive ? "var(--dl-strong)" : "var(--dl-border2)",
                border: "none", padding: 0, cursor: "pointer",
                opacity: isDragging ? 0.35 : 1,
                transition: "opacity 0.15s, background 0.2s",
                flexShrink: 0,
                touchAction: "none",
              }}
            />
          );
        })}

        {/* Separator */}
        <div style={{ width: 1, height: 12, background: "var(--dl-border)", flexShrink: 0, marginLeft: 2 }} />

        {/* + add page */}
        <button
          onClick={() => setAddingPage(true)}
          title="Add page"
          style={{
            width: 18, height: 18, borderRadius: "50%",
            background: "transparent", border: "none",
            color: "var(--dl-border2)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "color 0.15s", padding: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "var(--dl-strong)"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--dl-border2)"; }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <line x1="5" y1="1" x2="5" y2="9"/><line x1="1" y1="5" x2="9" y2="5"/>
          </svg>
        </button>
      </div>

      )}
    </div>
  );
}
