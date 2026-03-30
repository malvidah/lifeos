"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { mono, F } from "@/lib/tokens";

/**
 * PageDots — page navigation dots bar with page management.
 *
 * Features:
 *   • Pill dots — active page is a wider pill, inactive are small circles.
 *     The "home" page gets a rounded-square shape at rest.
 *   • Tap a dot  — navigate to that page.
 *   • Long-press a dot (500ms) — open a rename / move / home / delete popover.
 *   • Swipe left/right on the pill background — navigate prev/next page.
 *   • "+" button — shows an inline name input to create a new page.
 *
 * Props:
 *   count            number
 *   active           number              currently visible page index
 *   homeIdx          number              which page is the "home" (rounded-square)
 *   pages            Array<{name}>
 *   onDotClick       (i: number) => void
 *   onSwipePrev      () => void
 *   onSwipeNext      () => void
 *   onAddPage        (name: string) => void
 *   onRenamePage     (i: number, name: string) => void
 *   onDeletePage     (i: number) => void
 *   onReorderPages   (fromIdx: number, toIdx: number) => void
 *   onSetHomeIdx     (i: number) => void
 */
export default function PageDots({
  count, active, homeIdx = 1, pages = [],
  onDotClick, onSwipePrev, onSwipeNext,
  onAddPage, onRenamePage, onDeletePage,
  onReorderPages, onSetHomeIdx,
}) {
  // ── State ────────────────────────────────────────────────────────────────
  const [addingPage,   setAddingPage]   = useState(false);
  const [newPageName,  setNewPageName]  = useState("");
  const [menuPage,     setMenuPage]     = useState(null);  // index of page being edited
  const [renameValue,  setRenameValue]  = useState("");

  const longPressTimer  = useRef(null);
  const nameInputRef    = useRef(null);
  const renameInputRef  = useRef(null);

  // ── Swipe gesture on the pill background (not on dot buttons) ────────────
  const swipeRef = useRef(null);

  const onPillPointerDown = useCallback((e) => {
    if (e.target.closest('button') || e.target.closest('input')) return;
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

  // Focus inputs when they appear
  useEffect(() => {
    if (addingPage) {
      setNewPageName("");
      setTimeout(() => nameInputRef.current?.focus(), 40);
    }
  }, [addingPage]);

  useEffect(() => {
    if (menuPage !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 40);
    }
  }, [menuPage]);

  // ── Long-press on dot ─────────────────────────────────────────────────────
  const startDotLongPress = useCallback((i) => {
    longPressTimer.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(30);
      setMenuPage(i);
      setRenameValue(pages[i]?.name ?? "");
    }, 500);
  }, [pages]);

  const cancelDotLongPress = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);

  // ── Add page ──────────────────────────────────────────────────────────────
  const confirmAddPage = useCallback(() => {
    const name = newPageName.trim() || "New Page";
    onAddPage?.(name);
    setAddingPage(false);
    setNewPageName("");
  }, [newPageName, onAddPage]);

  // ── Rename / move / home / delete ─────────────────────────────────────────
  const confirmRename = useCallback(() => {
    const name = renameValue.trim();
    if (name && menuPage !== null) onRenamePage?.(menuPage, name);
    setMenuPage(null);
  }, [menuPage, renameValue, onRenamePage]);

  const confirmDelete = useCallback(() => {
    if (menuPage !== null) onDeletePage?.(menuPage);
    setMenuPage(null);
  }, [menuPage, onDeletePage]);

  const confirmMoveLeft = useCallback(() => {
    if (menuPage !== null && menuPage > 0) {
      onReorderPages?.(menuPage, menuPage - 1);
      setMenuPage(menuPage - 1); // follow the page
    }
  }, [menuPage, onReorderPages]);

  const confirmMoveRight = useCallback(() => {
    if (menuPage !== null && menuPage < count - 1) {
      onReorderPages?.(menuPage, menuPage + 1);
      setMenuPage(menuPage + 1); // follow the page
    }
  }, [menuPage, count, onReorderPages]);

  const confirmSetHome = useCallback(() => {
    if (menuPage !== null) onSetHomeIdx?.(menuPage);
    setMenuPage(null);
  }, [menuPage, onSetHomeIdx]);

  // ── Shared styles ─────────────────────────────────────────────────────────
  const inputStyle = {
    background: "var(--dl-bg)",
    border: "1px solid var(--dl-accent)",
    borderRadius: 6,
    padding: "4px 9px",
    color: "var(--dl-strong)",
    fontFamily: mono,
    fontSize: F.sm,
    outline: "none",
  };

  const btnStyle = (bg) => ({
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 7,
    padding: "5px 12px",
    cursor: "pointer",
    fontFamily: mono,
    fontSize: F.sm,
    flexShrink: 0,
  });

  const glassPill = {
    display: "flex",
    alignItems: "center",
    height: 34,
    background: "var(--dl-glass)",
    backdropFilter: "blur(16px) saturate(1.3)",
    WebkitBackdropFilter: "blur(16px) saturate(1.3)",
    border: "1px solid var(--dl-glass-border)",
    borderRadius: 100,
    boxShadow: "var(--dl-glass-shadow)",
    boxSizing: "border-box",
  };

  const circleBtn = (bg) => ({
    width: 22, height: 22, borderRadius: "50%",
    background: bg,
    border: "none", cursor: "pointer",
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, transition: "opacity 0.15s",
  });

  const isHome = (i) => i === homeIdx;

  return (
    <div style={{ position: "relative", flexShrink: 0, pointerEvents: "auto" }}>

      {/* ── Page options popover (long-press) ──────────────────────────────── */}
      {menuPage !== null && (
        <>
          <div
            style={{ position: "fixed", inset: 0, zIndex: 40 }}
            onClick={() => setMenuPage(null)}
          />
          <div style={{
            position: "absolute",
            bottom: "calc(100% + 8px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "var(--dl-card)",
            border: "1px solid var(--dl-border)",
            borderRadius: 14,
            padding: "14px 14px 12px",
            boxShadow: "0 8px 32px rgba(0,0,0,0.28)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
            minWidth: 210,
            zIndex: 50,
          }}>
            <span style={{
              fontFamily: mono, fontSize: 10, letterSpacing: "0.09em",
              textTransform: "uppercase", color: "var(--dl-middle)",
            }}>
              {pages[menuPage]?.name ?? `Page ${menuPage + 1}`}
            </span>

            {/* Rename */}
            <input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  confirmRename();
                if (e.key === "Escape") setMenuPage(null);
              }}
              placeholder="Page name"
              style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
            />

            {/* Move + Rename row */}
            <div style={{ display: "flex", gap: 7 }}>
              <button
                onClick={confirmMoveLeft}
                disabled={menuPage === 0}
                title="Move left"
                style={{
                  ...btnStyle("color-mix(in srgb, var(--dl-strong) 12%, transparent)"),
                  color: "var(--dl-strong)",
                  opacity: menuPage === 0 ? 0.3 : 1,
                  flex: 1,
                  padding: "5px 8px",
                }}
              >
                ← Move
              </button>
              <button onClick={confirmRename} style={{ ...btnStyle("var(--dl-accent)"), flex: 1 }}>
                Rename
              </button>
              <button
                onClick={confirmMoveRight}
                disabled={menuPage >= count - 1}
                title="Move right"
                style={{
                  ...btnStyle("color-mix(in srgb, var(--dl-strong) 12%, transparent)"),
                  color: "var(--dl-strong)",
                  opacity: menuPage >= count - 1 ? 0.3 : 1,
                  flex: 1,
                  padding: "5px 8px",
                }}
              >
                Move →
              </button>
            </div>

            {/* Set as home + Delete row */}
            <div style={{ display: "flex", gap: 7 }}>
              {!isHome(menuPage) && (
                <button
                  onClick={confirmSetHome}
                  title="Set as home page"
                  style={{
                    ...btnStyle("color-mix(in srgb, var(--dl-orange) 15%, transparent)"),
                    color: "var(--dl-orange)",
                    border: "1px solid color-mix(in srgb, var(--dl-orange) 30%, transparent)",
                    flex: 1,
                    fontSize: 11,
                  }}
                >
                  ◈ Set as home
                </button>
              )}
              {isHome(menuPage) && (
                <div style={{
                  flex: 1, textAlign: "center",
                  fontFamily: mono, fontSize: 11,
                  color: "var(--dl-orange)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 4,
                }}>
                  ◈ Home page
                </div>
              )}
              {count > 1 && (
                <button onClick={confirmDelete} style={btnStyle("var(--dl-red, #C0392B)")}>
                  Delete
                </button>
              )}
              <button
                onClick={() => setMenuPage(null)}
                style={{
                  ...btnStyle("transparent"),
                  color: "var(--dl-middle)",
                  border: "1px solid var(--dl-border)",
                }}
              >
                ✕
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Add-page input pill ────────────────────────────────────────────── */}
      {addingPage ? (
        <div style={{ ...glassPill, padding: "0 8px 0 14px", gap: 6, minWidth: 200 }}>
          <input
            ref={nameInputRef}
            value={newPageName}
            onChange={(e) => setNewPageName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter")  confirmAddPage();
              if (e.key === "Escape") setAddingPage(false);
            }}
            placeholder="Page name…"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--dl-strong)",
              fontFamily: mono,
              fontSize: F.sm,
              padding: 0,
              minWidth: 0,
            }}
          />
          <button onClick={confirmAddPage} title="Confirm" style={circleBtn("var(--dl-accent)")}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
          <button
            onClick={() => setAddingPage(false)}
            title="Cancel"
            style={{ ...circleBtn("color-mix(in srgb, var(--dl-strong) 10%, transparent)"), color: "var(--dl-middle)" }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      ) : (

      // ── Dots pill ──────────────────────────────────────────────────────────
      <div
        style={{ ...glassPill, justifyContent: "center", gap: 7, padding: "0 14px", userSelect: "none" }}
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
                border: "none",
                padding: 0,
                cursor: "pointer",
                transition: "width 0.25s cubic-bezier(.34,1.56,.64,1), height 0.2s, background 0.2s",
                flexShrink: 0,
              }}
            />
          );
        })}

        {/* Separator */}
        <div style={{ width: 1, height: 12, background: "var(--dl-border)", flexShrink: 0, marginLeft: 2 }} />

        {/* "+" add page button */}
        <button
          onClick={() => setAddingPage(true)}
          title="Add page"
          style={{
            width: 18, height: 18, borderRadius: "50%",
            background: "transparent",
            border: "none", color: "var(--dl-border2)", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0, transition: "color 0.15s",
            padding: 0,
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
