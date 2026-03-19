"use client";
import { mono, serif, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { todayKey } from "@/lib/dates";

// ── Apple-style liquid glass pill button ──────────────────────────────────────
function NavIconBtn({ onClick, active, title, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={title}
      title={title}
      style={{
        background: active ? 'var(--dl-glass-active)' : 'transparent',
        border: 'none', borderRadius: 100, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? "var(--dl-strong)" : "var(--dl-highlight)",
        width: 34, height: 34, flexShrink: 0,
        transition: 'background 0.2s, color 0.2s',
      }}
      onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-strong)"; e.currentTarget.style.background = 'var(--dl-glass-active)'; }}
      onMouseLeave={e => { e.currentTarget.style.color = active ? "var(--dl-strong)" : "var(--dl-highlight)"; e.currentTarget.style.background = active ? 'var(--dl-glass-active)' : 'transparent'; }}
    >
      {children}
    </button>
  );
}

// ── NavBar ────────────────────────────────────────────────────────────────────
// Layout: [gear]  ···  [dock icons]  ···  [search]
//
// Props:
//   onOpenSettings  – gear icon (only shown when truthy)
//   dockItems       – array of { id, label, icon, isOpen, onToggle }
//   searchOpen / setSearchOpen / searchQuery / setSearchQuery / searchInputRef / srLoading
export default function NavBar(props) {
  const {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading,
    onOpenSettings, dockItems,
  } = props;

  const openSearch  = () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 60); };
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };

  const showGear = !!onOpenSettings;

  const glassBar = {
    display: 'flex', alignItems: 'center', height: 44, flexShrink: 0, position: 'relative',
    background: 'var(--dl-glass)',
    backdropFilter: 'blur(20px) saturate(1.4)',
    WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
    border: '1px solid var(--dl-glass-border)',
    borderRadius: 100,
    padding: '0 5px',
    boxShadow: 'var(--dl-glass-shadow)',
  };

  // ── Search mode: replace entire nav bar with search input ──────────
  if (searchOpen) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', flexShrink: 0 }}>
        <div style={{ ...glassBar, padding: '0 6px 0 16px', gap: 8, width: '100%', maxWidth: 560 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={"var(--dl-highlight)"} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchInputRef}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') closeSearch(); }}
            placeholder="Search"
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              fontFamily: serif, fontSize: F.md, color: "var(--dl-strong)", caretColor: "var(--dl-accent)",
            }}
          />
          {srLoading && (
            <span style={{ fontFamily: mono, fontSize: 8, color: "var(--dl-highlight)", letterSpacing: '0.12em', flexShrink: 0 }}>…</span>
          )}
          <NavIconBtn onClick={closeSearch} title="Close search">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </NavIconBtn>
        </div>
      </div>
    );
  }

  // ── Normal nav bar: [gear] ··· [dock icons] ··· [search] ────────────
  return (
    <div style={glassBar}>

      {/* ── Left: settings ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', zIndex: 2, flexShrink: 0 }}>
        {showGear && (
          <NavIconBtn onClick={onOpenSettings} title="Settings">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </NavIconBtn>
        )}
      </div>

      {/* ── Center: dock icons ─────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'auto' }}>
          {dockItems?.map(item => (
            <NavIconBtn key={item.id} onClick={item.onToggle} active={item.isOpen} title={item.label}>
              {item.icon}
            </NavIconBtn>
          ))}
        </div>
      </div>

      {/* ── Right: search ──────────────────────────────────────────────── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', zIndex: 2, flexShrink: 0 }}>
        <NavIconBtn onClick={openSearch} title="Search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </NavIconBtn>
      </div>

    </div>
  );
}
