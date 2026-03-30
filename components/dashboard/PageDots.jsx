"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { mono, F } from "@/lib/tokens";

/**
 * PageDots — page navigation pill.
 *
 * Dots pill:
 *   • Tap a dot            → navigate to that page
 *   • Drag a dot L/R       → reorder pages (dots animate to new positions live)
 *   • Long-press dot 480ms → open compact glass popover (rename / delete)
 *   • Swipe pill bg L/R    → prev / next page
 *   • "+"                  → add page
 *
 * Home page dot shows ◈ icon in both selected and unselected states.
 *
 * Popover — compact glass pill, same visual language as nav:
 *   ◈ · [editable name] · 🗑 · ✕
 *   Trash requires two taps to confirm deletion.
 */
export default function PageDots({
  count, active, homeIdx = 1, pages = [],
  onDotClick, onSwipePrev, onSwipeNext,
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
  const swipeRef       = useRef(null);  // for pill-bg swipe gesture
  const dragRef        = useRef(null);  // { fromIdx, startX, dx } for dot drag
  const dragWasRef     = useRef(false); // suppress onClick after a drag

  // DOT_SPACING: approximate px between adjacent dot centres (dot width + gap).
  // Used to map horizontal drag distance → index offset.
  const DOT_SPACING = 15;

  // ── Swipe gesture on pill background (not on dot buttons) ─────────────────
  const onPillPointerDown = useCallback((e) => {
    if (e.target.closest("button") || e.target.closest("input")) return;
    swipeRef.current = { x: e.clientX };
  }, []);

  const onPillPointerUp = useCallback((e) => {
    if (!swipeRef.current) return;
    const dx = e.clientX - swipeRef.current.x;
    swipeRef.current = null;
    if (Math.abs(dx) < 20) return;   // lowered from 28 → easier swipe on mobile
    if (dx < 0) onSwipeNext?.();
    else         onSwipePrev?.();
  }, [onSwipePrev, onSwipeNext]);

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

  // ── Dot pointer handlers (drag-to-reorder + tap + long-press) ────────────
  const onDotPointerDown = useCallback((e, i) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { fromIdx: i, startX: e.clientX, dx: 0 };
    dragWasRef.current = false;
    startDotLongPress(i);
  }, [startDotLongPress]);

  const onDotPointerMove = useCallback((e, i) => {
    if (!dragRef.current || dragRef.current.fromIdx !== i) return;
    const dx = e.clientX - dragRef.current.startX;
    dragRef.current.dx = dx;
    if (Math.abs(dx) > 10) {
      cancelDotLongPress();
      const offset = Math.round(dx / DOT_SPACING);
      const toIdx  = Math.max(0, Math.min(count - 1, i + offset));
      setDragTo(prev => (prev?.fromIdx === i && prev?.toIdx === toIdx) ? prev : { fromIdx: i, toIdx });
    }
  }, [cancelDotLongPress, count]);

  const onDotPointerUp = useCallback((e, i) => {
    cancelDotLongPress();
    if (!dragRef.current || dragRef.current.fromIdx !== i) return;
    const { fromIdx, dx } = dragRef.current;
    dragRef.current = null;
    setDragTo(null);

    if (Math.abs(dx) > 10) {
      // Was a drag — reorder pages
      dragWasRef.current = true;
      const offset = Math.round(dx / DOT_SPACING);
      const toIdx  = Math.max(0, Math.min(count - 1, fromIdx + offset));
      if (fromIdx !== toIdx) onReorderPages?.(fromIdx, toIdx);
    }
    // If it was a tap, onClick fires naturally and handles navigation
  }, [cancelDotLongPress, count, onReorderPages]);

  const onDotPointerCancel = useCallback(() => {
    cancelDotLongPress();
    dragRef.current = null;
    setDragTo(null);
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
            {/* ◈ home indicator */}
            {isHome(menuPage) && (
              <span style={{ color: "var(--dl-orange)", fontSize: 10, opacity: 0.9, marginRight: 2, flexShrink: 0 }}>◈</span>
            )}

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
      <div
        style={{
          ...glass, borderRadius: 100, height: 40,
          display: "flex", alignItems: "center",
          justifyContent: "center", gap: 7,
          padding: "0 14px", userSelect: "none",
          // Wider touch target for easier swipe on mobile
          touchAction: "none",
        }}
        onPointerDown={onPillPointerDown}
        onPointerUp={onPillPointerUp}
        onPointerCancel={() => { swipeRef.current = null; }}
      >
        {displayOrder.map((pageIdx) => {
          const home     = isHome(pageIdx);
          const isActive = pageIdx === active;
          const isDragging = dragTo?.fromIdx === pageIdx;

          if (home) {
            // Home dot — always shows ◈ symbol in both selected and idle states
            return (
              <button
                key={pageIdx}
                title={pages[pageIdx]?.name ?? `Page ${pageIdx + 1}`}
                onClick={() => {
                  if (dragWasRef.current) { dragWasRef.current = false; return; }
                  cancelDotLongPress();
                  onDotClick(pageIdx);
                }}
                onPointerDown={(e) => onDotPointerDown(e, pageIdx)}
                onPointerMove={(e) => onDotPointerMove(e, pageIdx)}
                onPointerUp={(e) => onDotPointerUp(e, pageIdx)}
                onPointerCancel={onDotPointerCancel}
                style={{
                  background: isActive
                    ? "var(--dl-strong)"
                    : "transparent",
                  border: "none", padding: isActive ? "1px 6px" : "0",
                  borderRadius: isActive ? 4 : 0,
                  cursor: "pointer", flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  opacity: isDragging ? 0.4 : 1,
                  transition: "opacity 0.15s, background 0.2s, padding 0.2s",
                  touchAction: "none",
                }}
              >
                <span style={{
                  fontSize: 9,
                  lineHeight: 1,
                  color: isActive ? "var(--dl-bg)" : "var(--dl-accent)",
                  fontFamily: "system-ui, sans-serif",
                  display: "block",
                  opacity: isActive ? 1 : 0.75,
                  transition: "color 0.2s, opacity 0.2s",
                }}>◈</span>
              </button>
            );
          }

          // Regular dot
          return (
            <button
              key={pageIdx}
              title={pages[pageIdx]?.name ?? `Page ${pageIdx + 1}`}
              onClick={() => {
                if (dragWasRef.current) { dragWasRef.current = false; return; }
                cancelDotLongPress();
                onDotClick(pageIdx);
              }}
              onPointerDown={(e) => onDotPointerDown(e, pageIdx)}
              onPointerMove={(e) => onDotPointerMove(e, pageIdx)}
              onPointerUp={(e) => onDotPointerUp(e, pageIdx)}
              onPointerCancel={onDotPointerCancel}
              style={{
                width:        isActive ? 20 : 6,
                height:       isActive ? 6  : 6,
                borderRadius: 3,
                background:   isActive ? "var(--dl-strong)" : "var(--dl-border2)",
                border: "none", padding: 0, cursor: "pointer",
                opacity: isDragging ? 0.35 : 1,
                transition: "width 0.25s cubic-bezier(.34,1.56,.64,1), opacity 0.15s, background 0.2s",
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
