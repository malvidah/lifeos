"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { mono, F } from "@/lib/tokens";

/**
 * PageDots — page navigation dots bar with page management.
 *
 * Features:
 *   • Pill dots — active page is a wider pill, inactive are small circles.
 *     Animated with CSS transition.
 *   • Tap a dot  — navigate to that page.
 *   • Long-press a dot (500ms) — open a rename/delete popover for that page.
 *   • "+" button — shows an inline name input to create a new page.
 *   • Always rendered (even with 1 page) so the "+" is always accessible.
 *
 * Props:
 *   count          number
 *   active         number              currently visible page index
 *   pages          Array<{name}>       page configs (for displaying names)
 *   onDotClick     (i: number) => void
 *   onAddPage      (name: string) => void
 *   onRenamePage   (i: number, name: string) => void
 *   onDeletePage   (i: number) => void
 */
export default function PageDots({
  count, active, pages = [],
  onDotClick, onAddPage, onRenamePage, onDeletePage,
}) {
  // ── State ────────────────────────────────────────────────────────────────
  const [addingPage,   setAddingPage]   = useState(false);
  const [newPageName,  setNewPageName]  = useState("");
  const [menuPage,     setMenuPage]     = useState(null);  // index of page being edited
  const [renameValue,  setRenameValue]  = useState("");

  const longPressTimer  = useRef(null);
  const nameInputRef    = useRef(null);
  const renameInputRef  = useRef(null);

  // Focus the add-page input as soon as it mounts
  useEffect(() => {
    if (addingPage) {
      setNewPageName("");
      setTimeout(() => nameInputRef.current?.focus(), 40);
    }
  }, [addingPage]);

  // Focus the rename input when the page menu opens
  useEffect(() => {
    if (menuPage !== null) {
      setTimeout(() => renameInputRef.current?.focus(), 40);
    }
  }, [menuPage]);

  // ── Long-press on dot ────────────────────────────────────────────────────
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

  // ── Add page ─────────────────────────────────────────────────────────────
  const confirmAddPage = useCallback(() => {
    const name = newPageName.trim() || "New Page";
    onAddPage?.(name);
    setAddingPage(false);
    setNewPageName("");
  }, [newPageName, onAddPage]);

  // ── Rename / delete ───────────────────────────────────────────────────────
  const confirmRename = useCallback(() => {
    const name = renameValue.trim();
    if (name && menuPage !== null) onRenamePage?.(menuPage, name);
    setMenuPage(null);
  }, [menuPage, renameValue, onRenamePage]);

  const confirmDelete = useCallback(() => {
    if (menuPage !== null) onDeletePage?.(menuPage);
    setMenuPage(null);
  }, [menuPage, onDeletePage]);

  // ── Shared input style ────────────────────────────────────────────────────
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

  return (
    <div style={{ position: "relative", flexShrink: 0 }}>

      {/* ── Page rename/delete popover ───────────────────────────────────── */}
      {menuPage !== null && (
        <>
          {/* Dismiss backdrop */}
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
            minWidth: 200,
            zIndex: 50,
          }}>
            <span style={{
              fontFamily: mono, fontSize: 10, letterSpacing: "0.09em",
              textTransform: "uppercase", color: "var(--dl-middle)",
            }}>
              Page options
            </span>
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
            <div style={{ display: "flex", gap: 7 }}>
              <button onClick={confirmRename} style={{ ...btnStyle("var(--dl-accent)"), flex: 1 }}>
                Rename
              </button>
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

      {/* ── Dots row ────────────────────────────────────────────────────── */}
      <div style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: 7,
        padding: "8px 16px",
      }}>

        {/* Page dots */}
        {Array.from({ length: count }, (_, i) => (
          <button
            key={i}
            title={pages[i]?.name ?? `Page ${i + 1}`}
            onClick={() => { cancelDotLongPress(); onDotClick(i); }}
            onPointerDown={() => startDotLongPress(i)}
            onPointerUp={cancelDotLongPress}
            onPointerCancel={cancelDotLongPress}
            style={{
              width:  i === active ? 20 : 6,
              height: 6,
              borderRadius: 3,
              background: i === active ? "var(--dl-accent)" : "var(--dl-border2)",
              border: "none",
              padding: 0,
              cursor: "pointer",
              transition: "width 0.25s cubic-bezier(.34,1.56,.64,1), background 0.2s",
              flexShrink: 0,
            }}
          />
        ))}

        {/* Separator */}
        {!addingPage && (
          <div style={{ width: 1, height: 12, background: "var(--dl-border)", flexShrink: 0, marginLeft: 2 }} />
        )}

        {/* Add page: "+" button or inline name input */}
        {addingPage ? (
          <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <input
              ref={nameInputRef}
              value={newPageName}
              onChange={(e) => setNewPageName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter")  confirmAddPage();
                if (e.key === "Escape") setAddingPage(false);
              }}
              placeholder="Page name…"
              style={{ ...inputStyle, width: 130 }}
            />
            <button onClick={confirmAddPage} style={btnStyle("var(--dl-accent)")}>✓</button>
            <button
              onClick={() => setAddingPage(false)}
              style={{ ...btnStyle("transparent"), color: "var(--dl-middle)", border: "1px solid var(--dl-border)" }}
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setAddingPage(true)}
            title="Add page"
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: "var(--dl-border2)",
              border: "none",
              color: "var(--dl-middle)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              lineHeight: 1,
              fontWeight: "bold",
              flexShrink: 0,
              transition: "background 0.18s, color 0.18s",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--dl-accent)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--dl-border2)";
              e.currentTarget.style.color = "var(--dl-middle)";
            }}
          >
            +
          </button>
        )}
      </div>
    </div>
  );
}
