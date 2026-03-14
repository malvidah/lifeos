"use client";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { MONTHS_FULL } from "@/lib/dates";

// ── Format date key → "MARCH 13, 2026" ───────────────────────────────────────
function fmtNavDate(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${MONTHS_FULL[m - 1].toUpperCase()} ${d}, ${y}`;
}

// ── NavIconBtn ────────────────────────────────────────────────────────────────
function NavIconBtn({ onClick, active, title, children }) {
  return (
    <button
      onClick={onClick}
      aria-label={title}
      title={title}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: active ? "var(--dl-strong)" : "var(--dl-highlight)",
        width: 40, height: 48, flexShrink: 0,
        transition: 'color 0.15s',
      }}
      onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
      onMouseLeave={e => { e.currentTarget.style.color = active ? "var(--dl-strong)" : "var(--dl-highlight)"; }}
    >
      {children}
    </button>
  );
}

// ── NavBar ────────────────────────────────────────────────────────────────────
// Layout: [cal] [grid]  ···  BIG TITLE  ···  [gear?] [search]
//
// Props:
//   activeProject   – null = daily view, string = project/graph/everything view
//   date            – selected date key "YYYY-MM-DD" (shown as title in daily view)
//   onGoHome        – calendar icon → daily view / today
//   onGoToProjects  – grid icon → all-projects / graph view
//   onOpenSettings  – gear icon (only shown when truthy, i.e. real project view)
//   searchOpen / setSearchOpen / searchQuery / setSearchQuery / searchInputRef / srLoading
function stepDateKey(dateKey, dir) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dir);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

export default function NavBar(props) {
  const {
    activeProject, date,
    searchOpen, setSearchOpen, searchQuery, setSearchQuery, searchInputRef, srLoading,
    onGoHome, onGoToProjects, onOpenSettings, onSelectDate,
  } = props;

  const openSearch  = () => { setSearchOpen(true); setTimeout(() => searchInputRef.current?.focus(), 60); };
  const closeSearch = () => { setSearchOpen(false); setSearchQuery(''); };

  const isGraph      = activeProject === '__graph__';
  const isEverything = activeProject === '__everything__';
  const isProject    = activeProject && !isGraph && !isEverything;

  const centerLabel = !activeProject  ? fmtNavDate(date)
    : isGraph                         ? 'ALL PROJECTS'
    : isEverything                    ? 'ALL'
    : tagDisplayName(activeProject);

  const titleColor = isProject ? projectColor(activeProject) : "var(--dl-strong)";
  const showGear   = !!onOpenSettings;

  return (
    <div style={{ display: 'flex', alignItems: 'center', height: 48, flexShrink: 0, position: 'relative' }}>

      {/* ── Left icons ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', zIndex: 2, flexShrink: 0,
        opacity: searchOpen ? 0 : 1, pointerEvents: searchOpen ? 'none' : 'auto',
        transition: 'opacity 0.18s ease',
      }}>
        {/* Calendar → daily view */}
        <NavIconBtn onClick={onGoHome} active={!activeProject} title="Daily view">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <line x1="3"  y1="9"  x2="21" y2="9"/>
            <line x1="16" y1="2"  x2="16" y2="6"/>
            <line x1="8"  y1="2"  x2="8"  y2="6"/>
          </svg>
        </NavIconBtn>
        {/* Grid → all projects */}
        <NavIconBtn onClick={onGoToProjects} active={!!activeProject} title="All projects">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2"  y="2"  width="9" height="9" rx="1.5"/>
            <rect x="13" y="2"  width="9" height="9" rx="1.5"/>
            <rect x="2"  y="13" width="9" height="9" rx="1.5"/>
            <rect x="13" y="13" width="9" height="9" rx="1.5"/>
          </svg>
        </NavIconBtn>
      </div>

      {/* ── Center title — absolutely centred, never pushes left/right ─── */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        pointerEvents: 'none',
        opacity: searchOpen ? 0 : 1,
        transition: 'opacity 0.18s ease',
      }}>
        {!activeProject && onSelectDate ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, pointerEvents: 'auto' }}>
            <button onClick={() => onSelectDate(stepDateKey(date, -1))} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: "var(--dl-highlight)", padding: '2px 6px', fontFamily: mono, fontSize: 16,
              lineHeight: 1, transition: 'color 0.15s', userSelect: 'none',
            }}
              onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
              onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
            >‹</button>
            <span style={{
              fontFamily: mono, fontSize: 13, fontWeight: 400, letterSpacing: '0.12em',
              textTransform: 'uppercase', color: titleColor,
              whiteSpace: 'nowrap', userSelect: 'none',
            }}>
              {centerLabel}
            </span>
            <button onClick={() => onSelectDate(stepDateKey(date, +1))} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: "var(--dl-highlight)", padding: '2px 6px', fontFamily: mono, fontSize: 16,
              lineHeight: 1, transition: 'color 0.15s', userSelect: 'none',
            }}
              onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
              onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
            >›</button>
          </div>
        ) : (
          <span style={{
            fontFamily: mono, fontSize: 13, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: titleColor,
            whiteSpace: 'nowrap', userSelect: 'none',
          }}>
            {centerLabel}
          </span>
        )}
      </div>

      {/* ── Right icons ─────────────────────────────────────────────────── */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', zIndex: 2, flexShrink: 0 }}>
        {/* Gear — project view only, hidden during search */}
        {showGear && (
          <button
            onClick={onOpenSettings}
            aria-label="Project settings"
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: "var(--dl-highlight)", width: 40, height: 48, flexShrink: 0,
              opacity: searchOpen ? 0 : 1, pointerEvents: searchOpen ? 'none' : 'auto',
              transition: 'color 0.15s, opacity 0.18s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        )}

        {/* Search */}
        <button
          onClick={searchOpen ? closeSearch : openSearch}
          aria-label={searchOpen ? 'Close search' : 'Search'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: searchOpen ? "var(--dl-strong)" : "var(--dl-highlight)",
            width: 40, height: 48, flexShrink: 0,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
          onMouseLeave={e => { if (!searchOpen) e.currentTarget.style.color = "var(--dl-highlight)"; }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </button>
      </div>

      {/* ── Search pill overlay — crossfades in when searchOpen ─────────── */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: searchOpen ? 1 : 0,
        pointerEvents: searchOpen ? 'auto' : 'none',
        transition: 'opacity 0.18s ease',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 48px', // symmetric — leaves room for search icon on right
      }}>
        <div style={{
          width: '100%', maxWidth: 520,
          display: 'flex', alignItems: 'center', gap: 8,
          backdropFilter: 'blur(20px) saturate(1.4)',
          WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
          background: `var(--dl-surface)ee`,
          border: `1px solid var(--dl-border)`,
          borderRadius: 100,
          padding: '0 16px', height: 44,
          boxShadow: "var(--dl-shadow)",
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={"var(--dl-highlight)"} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
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
              fontFamily: mono, fontSize: F.md, color: "var(--dl-strong)", caretColor: "var(--dl-accent)",
            }}
          />
          {srLoading && (
            <span style={{ fontFamily: mono, fontSize: 8, color: "var(--dl-highlight)", letterSpacing: '0.12em', flexShrink: 0 }}>…</span>
          )}
          <button
            onClick={closeSearch}
            aria-label="Close search"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
              color: "var(--dl-highlight)", display: 'flex', alignItems: 'center', flexShrink: 0,
              transition: 'color 0.12s',
            }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6"  x2="6"  y2="18"/>
              <line x1="6"  y1="6"  x2="18" y2="18"/>
            </svg>
          </button>
        </div>
      </div>

    </div>
  );
}
