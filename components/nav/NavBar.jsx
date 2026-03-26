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
// Layout (tools closed): [tools btn]  ···  [project name]  ···  [search]
// Layout (tools open):   [tools btn]  ···  [dock icons]    ···  [search]
//
// Props:
//   dockItems       – array of { id, label, icon, isOpen, onToggle }
//   toolsOpen / setToolsOpen – toggle between project name and dock icons
//   activeProjectName – string like "All Projects" or "Big Think"
//   searchOpen / setSearchOpen / searchQuery / setSearchQuery / searchInputRef / srLoading
export default function NavBar(props) {
  const {
    searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading,
    dockItems,
    toolsOpen, setToolsOpen, activeProjectName, onBack,
  } = props;

  const openSearch  = () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 60); };
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };

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

  // ── Normal nav bar: [tools] ··· [name/dock] ··· [search] ───────────
  return (
    <div style={glassBar}>

      {/* ── Left: tools toggle ────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', zIndex: 2, flexShrink: 0 }}>
        <NavIconBtn onClick={() => setToolsOpen(!toolsOpen)} active={toolsOpen} title="Toggle cards">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/>
          </svg>
        </NavIconBtn>
      </div>

      {/* ── Center: project name OR dock icons ─────────────────────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
      }}>
        {toolsOpen ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 2, pointerEvents: 'auto' }}>
            {dockItems?.map(item => (
              <NavIconBtn key={item.id} onClick={item.onToggle} active={item.isOpen} title={item.label}>
                {item.icon}
              </NavIconBtn>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}>
            {activeProjectName && onBack && (
              <button onClick={onBack} title="Back to All Projects"
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px', color: 'var(--dl-highlight)', display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-highlight)'}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6"/>
                </svg>
              </button>
            )}
            <span style={{
              fontFamily: mono, fontSize: 11, letterSpacing: '0.1em',
              textTransform: 'uppercase', color: 'var(--dl-highlight)',
              cursor: activeProjectName ? 'pointer' : 'default',
            }}
              onClick={activeProjectName && onBack ? onBack : undefined}
            >
              {activeProjectName || 'All Projects'}
            </span>
          </div>
        )}
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
