"use client";
import { useState, useEffect } from "react";
import { mono, F, blurweb } from "@/lib/tokens";
import { toKey, todayKey, MONTHS_FULL } from "@/lib/dates";
import UserMenu from "./UserMenu.jsx";
import { OfflineIndicator } from "../ui/OfflineBanner.jsx";

function fmtNavDate(dateKey) {
  if (!dateKey) return '';
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${MONTHS_FULL[m - 1].toUpperCase()} ${d}, ${y}`;
}

const DAYS_FULL = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
// Get the Sunday that starts the Sun-Sat week containing a date
function weekStart(date) {
  const s = new Date(date);
  s.setDate(s.getDate() - s.getDay());
  return s;
}
function fmtRelative(dateKey, today) {
  if (!dateKey || !today) return null;
  if (dateKey === today) return 'TODAY';
  const d = new Date(dateKey + 'T12:00:00');
  const t = new Date(today + 'T12:00:00');
  const diffDays = Math.round((t - d) / 86400000);
  if (diffDays === 1) return 'YESTERDAY';
  if (diffDays === -1) return 'TOMORROW';
  const absDays = Math.abs(diffDays);
  const dayName = DAYS_FULL[d.getDay()];
  // Sun-Sat week comparison
  const todayWeekStart = weekStart(t).getTime();
  const dateWeekStart = weekStart(d).getTime();
  const sameWeek = todayWeekStart === dateWeekStart;
  if (diffDays > 0) {
    if (sameWeek) return dayName;
    if (absDays <= 13) return `LAST ${dayName}`;
    if (absDays < 30) { const half = Math.round(absDays / 7 * 2) / 2; return `${half} WEEK${half === 1 ? '' : 'S'} AGO`; }
    const totalMonths = (t.getFullYear() - d.getFullYear()) * 12 + (t.getMonth() - d.getMonth());
    if (totalMonths < 2) return 'LAST MONTH';
    if (totalMonths < 12) return `${totalMonths} MONTHS AGO`;
    const yrs = Math.floor(totalMonths / 12); const mos = totalMonths % 12;
    if (mos === 0) return yrs === 1 ? 'LAST YEAR' : `${yrs} YEARS AGO`;
    return `${yrs} YEAR${yrs > 1 ? 'S' : ''} ${mos} MONTH${mos > 1 ? 'S' : ''} AGO`;
  }
  if (sameWeek) return dayName;
  if (absDays <= 13) return `NEXT ${dayName}`;
  if (absDays < 30) { const half = Math.round(absDays / 7 * 2) / 2; return `IN ${half} WEEK${half === 1 ? '' : 'S'}`; }
  const totalMonths = (d.getFullYear() - t.getFullYear()) * 12 + (d.getMonth() - t.getMonth());
  if (totalMonths < 2) return 'NEXT MONTH';
  if (totalMonths < 12) return `IN ${totalMonths} MONTHS`;
  const yrs = Math.floor(totalMonths / 12); const mos = totalMonths % 12;
  if (mos === 0) return yrs === 1 ? 'NEXT YEAR' : `IN ${yrs} YEARS`;
  return `IN ${yrs} YEAR${yrs > 1 ? 'S' : ''} ${mos} MONTH${mos > 1 ? 'S' : ''}`;
}

function stepDateKey(dateKey, dir) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dir);
  return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

export default function Header({session,token,userId,syncStatus,theme,themePreference,onThemeChange,selected,onSelectDate,onGoToToday,onGoHome,stravaConnected,onStravaChange,leftContent}) {
  const isElectron = typeof window !== "undefined" && (!!window.daylabNative || !!window.dayloopNative);
  const today = todayKey();
  const relLabel = fmtRelative(selected, today);
  const isToday = selected === today;

  return (
    <div style={{
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 28px)",
      paddingLeft: 18, paddingRight: 14,
      paddingBottom: 10,
      flexShrink: 0,
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 100,
      background: "var(--dl-glass)",
      backdropFilter: "blur(20px) saturate(1.4)",
      WebkitBackdropFilter: "blur(20px) saturate(1.4)",
      boxShadow: "var(--dl-glass-shadow)",
      borderBottom: "1px solid var(--dl-glass-border)",
      WebkitAppRegion: "drag", userSelect: "none",
    }}>
      {/* Pull-down overscroll patch */}
      <div style={{position:"fixed",top:"-100px",left:0,right:0,height:"100px",background:"var(--dl-bg)",zIndex:99}}/>

      {/* Date display — centered, replaces DAY LAB wordmark */}
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        display: "flex", alignItems: "center", justifyContent: "center",
        paddingBottom: 6,
        WebkitAppRegion: "drag",
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, WebkitAppRegion: "no-drag" }}>
          <button onClick={() => onSelectDate?.(stepDateKey(selected, -1))} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: "var(--dl-highlight)", padding: '2px 6px', fontFamily: mono, fontSize: 18,
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
              fontFamily: blurweb, fontSize: 16, fontWeight: 400, letterSpacing: '0.06em',
              textTransform: 'uppercase', color: "var(--dl-strong)",
              whiteSpace: 'nowrap', userSelect: 'none', transition: 'opacity 0.15s',
            }}
              onMouseEnter={e => e.currentTarget.style.opacity = '0.6'}
              onMouseLeave={e => e.currentTarget.style.opacity = '1'}
            >{fmtNavDate(selected)}</button>
          </div>
          <button onClick={() => onSelectDate?.(stepDateKey(selected, +1))} style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: "var(--dl-highlight)", padding: '2px 6px', fontFamily: mono, fontSize: 18,
            lineHeight: 1, transition: 'color 0.15s', userSelect: 'none',
          }}
            onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
            onMouseLeave={e => e.currentTarget.style.color = "var(--dl-highlight)"}
          >›</button>
          {!isToday && (
            <button onClick={onGoToToday} style={{
              fontFamily: mono, fontSize: 9, letterSpacing: '0.08em',
              background: 'var(--dl-accent-10, rgba(208,136,40,0.1))',
              color: 'var(--dl-accent)',
              border: '1px solid var(--dl-accent-30, rgba(208,136,40,0.25))',
              borderRadius: 100, padding: '3px 8px', cursor: 'pointer',
              lineHeight: 1, userSelect: 'none', transition: 'all 0.15s',
              marginLeft: 4,
            }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--dl-accent-20, rgba(208,136,40,0.2))'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'var(--dl-accent-10, rgba(208,136,40,0.1))'; }}
            >TODAY</button>
          )}
        </div>
      </div>

      {/* Offline indicator (left) + User menu (right) — overlaid */}
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        height: 0,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        transform: "translateY(-36px)",
        WebkitAppRegion: "drag",
      }}>
        <div style={{WebkitAppRegion:"no-drag", position:"relative", zIndex:101, padding: '8px 0'}}>
          {leftContent || <OfflineIndicator/>}
        </div>
        <div style={{WebkitAppRegion:"no-drag", position:"relative", zIndex:101}}>
          <UserMenu session={session} token={token} userId={userId} theme={theme} themePreference={themePreference} onThemeChange={onThemeChange} stravaConnected={stravaConnected} onStravaChange={onStravaChange}/>
        </div>
      </div>
    </div>
  );
}
