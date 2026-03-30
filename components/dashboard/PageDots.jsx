"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { mono, F } from "@/lib/tokens";

/**
 * PageDots — page navigation pill.
 *
 * Dots pill:
 *   • Tap a dot       → navigate to that page
 *   • Long-press dot  → open compact glass popover (inline rename, move, delete)
 *   • Swipe pill bg   → prev / next page
 *   • "+"             → add page
 *
 * Popover (glass pill, same visual language as nav):
 *   ◈ (home indicator, orange) · [editable name] · ‹ · › · 🗑 · ✕
 *   Trash requires two taps — first tap arms it (turns red), second confirms.
 */
export default function PageDots({
  count, active, homeIdx = 1, pages = [],
  onDotClick, onSwipePrev, onSwipeNext,
  onAddPage, onRenamePage, onDeletePage,
  onReorderPages,
}) {
  // ── State ─────────────────────────────────────────────────────────────────
  const [addingPage,    setAddingPage]    = useState(false);
  const [newPageName,   setNewPageName]   = useState("");
  const [menuPage,      setMenuPage]      = useState(null);  // index being managed
  const [nameEditing,   setNameEditing]   = useState(false); // inline edit active
  const [nameValue,     setNameValue]     = useState("");
  const [deleteArmed,   setDeleteArmed]   = useState(false); // two-tap trash confirm

  const longPressTimer = useRef(null);
  const addInputRef    = useRef(null);
  const nameInputRef   = useRef(null);
  const deleteTimer    = useRef(null);
  const swipeRef       = useRef(null);

  // ── Swipe gesture on pill background ──────────────────────────────────────
  const onPillPointerDown = useCallback((e) => {
    if (e.target.closest("button") || e.target.closest("input")) return;
    swipeRef.current = { x: e.clientX };
  }, []);

  const onPillPointerUp = useCallback((e) => {
    if (!swipeRef.current) return;
    const dx = e.clientX - swipeRef.current.x;
    swipeRef.current = null;
    if (Math.abs(dx) < 28) return;
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

  // ── Focus inputs when they appear ─────────────────────────────────────────
  useEffect(() => {
    if (addingPage) {
      setNewPageName("");
      setTimeout(() => addInputRef.current?.focus(), 40);
    }
  }, [addingPage]);

  useEffect(() => {
    if (nameEditing) {
      setTimeout(() => nameInputRef.current?.focus(), 20);
    }
  }, [nameEditing]);

  // ── Close popover ─────────────────────────────────────────────────────────
  const closeMenu = useCallback(() => {
    setMenuPage(null);
    setNameEditing(false);
    setDeleteArmed(false);
    clearTimeout(deleteTimer.current);
  }, []);

  // ── Inline rename ─────────────────────────────────────────────────────────
  const commitRename = useCallback(() => {
    const trimmed = nameValue.trim();
    if (trimmed && menuPage !== null && trimmed !== (pages[menuPage]?.name ?? "")) {
      onRenamePage?.(menuPage, trimmed);
    }
    setNameEditing(false);
  }, [nameValue, menuPage, pages, onRenamePage]);

  // ── Move ──────────────────────────────────────────────────────────────────
  const moveLeft = useCallback(() => {
    if (menuPage === null || menuPage === 0) return;
    onReorderPages?.(menuPage, menuPage - 1);
    setMenuPage(menuPage - 1);
    setDeleteArmed(false);
  }, [menuPage, onReorderPages]);

  const moveRight = useCallback(() => {
    if (menuPage === null || menuPage >= count - 1) return;
    onReorderPages?.(menuPage, menuPage + 1);
    setMenuPage(menuPage + 1);
    setDeleteArmed(false);
  }, [menuPage, count, onReorderPages]);

  // ── Two-tap delete ────────────────────────────────────────────────────────
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

  // ── Shared glass style (matches nav pills exactly) ────────────────────────
  const glass = {
    background:          "var(--dl-glass)",
    backdropFilter:      "blur(16px) saturate(1.3)",
    WebkitBackdropFilter:"blur(16px) saturate(1.3)",
    border:              "1px solid var(--dl-glass-border)",
    boxShadow:           "var(--dl-glass-shadow)",
  };

  // Tiny ghost button used for all icon actions in the popover
  const ghostBtn = (extra = {}) => ({
    background: "none", border: "none", cursor: "pointer",
    color: "var(--dl-middle)", padding: "0 4px",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, transition: "opacity 0.15s, color 0.15s",
    opacity: 0.55, borderRadius: 4,
    fontSize: 13,
    ...extra,
  });

  const isHome = (i) => i === homeIdx;

  return (
    <div style={{ position: "relative", flexShrink: 0, pointerEvents: "auto" }}>

      {/* ── Page options popover (long-press) ──────────────────────────────── */}
      {menuPage !== null && (
        <>
          {/* Dismiss backdrop */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={closeMenu}
          />

          {/* Compact glass pill — same height / radius / blur as nav pills */}
          <div style={{
            ...glass,
            position: "absolute",
            bottom: "calc(100% + 10px)",
            left: "50%",
            transform: "translateX(-50%)",
            borderRadius: 100,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            height: 40,
            padding: "0 6px 0 14px",
            gap: 2,
            whiteSpace: "nowrap",
          }}>

            {/* Home indicator — orange ◈ only for the home page */}
            {isHome(menuPage) && (
              <span style={{
                color: "var(--dl-orange)", fontSize: 11, opacity: 0.85,
                marginRight: 2, flexShrink: 0,
              }}>◈</span>
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
                  background: "transparent",
                  border: "none", outline: "none",
                  color: "var(--dl-strong)",
                  fontFamily: mono, fontSize: F.sm,
                  width: Math.max(60, nameValue.length * 8),
                  padding: 0,
                }}
              />
            ) : (
              <span
                onClick={() => { setNameEditing(true); setNameValue(pages[menuPage]?.name ?? ""); }}
                title="Click to rename"
                style={{
                  fontFamily: mono, fontSize: F.sm,
                  color: "var(--dl-strong)",
                  cursor: "text",
                  padding: "0 4px",
                  userSelect: "none",
                  letterSpacing: "0.04em",
                }}
              >
                {pages[menuPage]?.name ?? `Page ${menuPage + 1}`}
              </span>
            )}

            {/* Divider */}
            <div style={{ width: 1, height: 14, background: "var(--dl-glass-border)", margin: "0 4px", flexShrink: 0 }} />

            {/* Move left ‹ */}
            <button
              onClick={moveLeft}
              disabled={menuPage === 0}
              title="Move left"
              style={{
                ...ghostBtn(),
                opacity: menuPage === 0 ? 0.2 : 0.55,
                cursor: menuPage === 0 ? "default" : "pointer",
                fontSize: 16, fontWeight: 300,
              }}
              onMouseEnter={(e) => { if (menuPage > 0) e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = menuPage === 0 ? "0.2" : "0.55"; }}
            >‹</button>

            {/* Move right › */}
            <button
              onClick={moveRight}
              disabled={menuPage >= count - 1}
              title="Move right"
              style={{
                ...ghostBtn(),
                opacity: menuPage >= count - 1 ? 0.2 : 0.55,
                cursor: menuPage >= count - 1 ? "default" : "pointer",
                fontSize: 16, fontWeight: 300,
              }}
              onMouseEnter={(e) => { if (menuPage < count - 1) e.currentTarget.style.opacity = 1; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = menuPage >= count - 1 ? "0.2" : "0.55"; }}
            >›</button>

            {/* Divider */}
            <div style={{ width: 1, height: 14, background: "var(--dl-glass-border)", margin: "0 4px", flexShrink: 0 }} />

            {/* Trash — two-tap confirm */}
            {count > 1 && (
              <button
                onClick={handleTrash}
                title={deleteArmed ? "Tap again to delete" : "Delete page"}
                style={{
                  ...ghostBtn(),
                  opacity: deleteArmed ? 1 : 0.45,
                  color: deleteArmed ? "var(--dl-red, #C0392B)" : "var(--dl-middle)",
                  transition: "color 0.2s, opacity 0.2s",
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

            {/* Close ✕ */}
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
          ...glass,
          borderRadius: 100, height: 34,
          display: "flex", alignItems: "center",
          padding: "0 8px 0 14px", gap: 6, minWidth: 180,
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
              color: "var(--dl-strong)", fontFamily: mono, fontSize: F.sm, padding: 0, minWidth: 0,
            }}
          />
          <button
            onClick={confirmAddPage}
            style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "var(--dl-accent)", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            }}
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
          <button
            onClick={() => setAddingPage(false)}
            style={{
              width: 22, height: 22, borderRadius: "50%",
              background: "color-mix(in srgb, var(--dl-strong) 10%, transparent)",
              border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              color: "var(--dl-middle)",
            }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

      ) : (

      // ── Dots pill ──────────────────────────────────────────────────────────
      <div
        style={{
          ...glass,
          borderRadius: 100, height: 34,
          display: "flex", alignItems: "center",
          justifyContent: "center", gap: 7,
          padding: "0 14px", userSelect: "none",
        }}
        onPointerDown={onPillPointerDown}
        onPointerUp={onPillPointerUp}
        onPointerCancel={() => { swipeRef.current = null; }}
      >
        {Array.from({ length: count }, (_, i) => {
          const home     = isHome(i);
          const isActive = i === active;
          return (
            <button
              key={i}
              title={pages[i]?.name ?? `Page ${i + 1}`}
              onClick={() => { cancelDotLongPress(); onDotClick(i); }}
              onPointerDown={() => startDotLongPress(i)}
              onPointerUp={cancelDotLongPress}
              onPointerCancel={cancelDotLongPress}
              style={{
                width:        isActive ? 20 : (home ? 7 : 6),
                height:       isActive ? 6  : (home ? 7 : 6),
                borderRadius: isActive ? 3  : (home ? 2 : 3),
                background:   isActive ? "var(--dl-strong)" : "var(--dl-border2)",
                border: "none", padding: 0, cursor: "pointer",
                transition: "width 0.25s cubic-bezier(.34,1.56,.64,1), height 0.2s, background 0.2s",
                flexShrink: 0,
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
