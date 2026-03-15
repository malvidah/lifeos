"use client";
import { mono, F, projectColor } from "@/lib/tokens";
import { tagDisplayName } from "@/lib/tags";
import { MONTHS_FULL, todayKey } from "@/lib/dates";

// ── Format date key → "MARCH 13, 2026" ───────────────────────────────────────
function fmtNavDate(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${MONTHS_FULL[m - 1].toUpperCase()} ${d}, ${y}`;
}

// ── Relative date label ──────────────────────────────────────────────────────
const DAYS_FULL = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
function fmtRelative(dateKey, todayKey) {
  if (!dateKey || !todayKey) return null;
  if (dateKey === todayKey) return 'TODAY';
  const d = new Date(dateKey + 'T12:00:00');
  const t = new Date(todayKey + 'T12:00:00');
  const diffDays = Math.round((t - d) / 86400000);

  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays === -1) return 'TOMORROW';

  const absDays = Math.abs(diffDays);
  const dayName = DAYS_FULL[d.getDay()];

  // Past dates
  if (diffDays > 0) {
    if (absDays <= 6) return `LAST ${dayName}`;
    if (absDays < 30) {
      const half = Math.round(absDays / 7 * 2) / 2; // round to nearest 0.5
      return `${half} WEEK${half === 1 ? '' : 'S'} AGO`;
    }
    const totalMonths = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
    if (totalMonths < 2) return 'LAST MONTH';
    if (totalMonths < 12) return `${totalMonths} MONTHS AGO`;
    const yrs = Math.floor(totalMonths / 12);
    const mos = totalMonths % 12;
    if (mos === 0) return yrs === 1 ? 'LAST YEAR' : `${yrs} YEARS AGO`;
    return `${yrs} YEAR${yrs > 1 ? 'S' : ''} ${mos} MONTH${mos > 1 ? 'S' : ''} AGO`;
  }

  // Future dates
  if (absDays <= 6) return `THIS ${dayName}`;
  if (absDays < 30) {
    const half = Math.round(absDays / 7 * 2) / 2;
    return `IN ${half} WEEK${half === 1 ? '' : 'S'}`;
  }
  const totalMonths = (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth());
  if (totalMonths < 2) return 'NEXT MONTH';
  if (totalMonths < 12) return `IN ${totalMonths} MONTHS`;
  const yrs = Math.floor(totalMonths / 12);
  const mos = totalMonths % 12;
  if (mos === 0) return yrs === 1 ? 'NEXT YEAR' : `IN ${yrs} YEARS`;
  return `IN ${yrs} YEAR${yrs > 1 ? 'S' : ''} ${mos} MONTH${mos > 1 ? 'S' : ''}`;
}

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

  const today = todayKey();
  const relLabel = !activeProject ? fmtRelative(date, today) : null;
  const isToday = date === today;
  const centerLabel = !activeProject  ? fmtNavDate(date)
    : isGraph                         ? 'ALL PROJECTS'
    : isEverything                    ? 'ALL'
    : tagDisplayName(activeProject);

  const titleColor = isProject ? projectColor(activeProject) : "var(--dl-strong)";
  const showGear   = !!onOpenSettings;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', height: 44, flexShrink: 0, position: 'relative',
      background: 'var(--dl-glass)',
      backdropFilter: 'blur(24px) brightness(1.05) saturate(1.3)',
      WebkitBackdropFilter: 'blur(24px) brightness(1.05) saturate(1.3)',
      border: '1px solid var(--dl-glass-border)',
      borderRadius: 100,
      padding: '0 5px',
      boxShadow: 'var(--dl-glass-shadow)',
    }}>

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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
              {relLabel && (
                <span style={{
                  fontFamily: mono, fontSize: 9, letterSpacing: '0.16em',
                  color: isToday ? "var(--dl-orange)" : "var(--dl-middle)",
                  lineHeight: 1, marginBottom: -1,
                }}>{relLabel}</span>
              )}
              <button onClick={onGoHome} style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '4px 8px',
                fontFamily: mono, fontSize: 13, fontWeight: 400, letterSpacing: '0.12em',
                textTransform: 'uppercase', color: titleColor,
                whiteSpace: 'nowrap', userSelect: 'none', transition: 'opacity 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.6'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                {centerLabel}
              </button>
            </div>
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
              background: 'transparent', border: 'none', borderRadius: 100, cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: "var(--dl-highlight)", width: 34, height: 34, flexShrink: 0,
              opacity: searchOpen ? 0 : 1, pointerEvents: searchOpen ? 'none' : 'auto',
              transition: 'background 0.2s, color 0.2s, opacity 0.18s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-strong)"; e.currentTarget.style.background = 'var(--dl-glass-active)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--dl-highlight)"; e.currentTarget.style.background = 'transparent'; }}
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
            background: searchOpen ? 'var(--dl-glass-active)' : 'transparent',
            border: 'none', borderRadius: 100, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: searchOpen ? "var(--dl-strong)" : "var(--dl-highlight)",
            width: 34, height: 34, flexShrink: 0,
            transition: 'background 0.2s, color 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-strong)"; e.currentTarget.style.background = 'var(--dl-glass-active)'; }}
          onMouseLeave={e => { if (!searchOpen) { e.currentTarget.style.color = "var(--dl-highlight)"; e.currentTarget.style.background = 'transparent'; } }}
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
