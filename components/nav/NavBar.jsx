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
// Layout: [mountain]  ···  [dock icons]  ···  [search]
//
// Props:
//   dockItems       – array of { id, label, icon, isOpen, onToggle }
//   searchOpen / setSearchOpen / searchQuery / setSearchQuery / searchInputRef / srLoading
export default function NavBar(props) {
  const {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading,
    dockItems,
  } = props;

  const openSearch  = () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 60); };
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };

  // Extract mountain/map item from dock to render on the left
  const mapItem = dockItems?.find(item => item.id === 'map');
  const remainingDockItems = dockItems?.filter(item => item.id !== 'map');

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

  // ── Normal nav bar: [mountain] ··· [dock icons] ··· [search] ────────
  return (
    <div style={glassBar}>

      {/* ── Left: mountain/map toggle ────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', zIndex: 2, flexShrink: 0 }}>
        {mapItem && (
          <NavIconBtn onClick={mapItem.onToggle} active={mapItem.isOpen} title={mapItem.label}>
            {mapItem.icon}
          </NavIconBtn>
        )}
      </div>

      {/* ── Center: dock icons (excluding map) ───────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'auto' }}>
          {remainingDockItems?.map(item => (
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
