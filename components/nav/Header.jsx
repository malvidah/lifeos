"use client";
import { useState, useEffect } from "react";
import { mono, F, blurweb } from "@/lib/tokens";
import { toKey, todayKey, DAYS_SHORT, MONTHS_SHORT } from "@/lib/dates";
import UserMenu from "./UserMenu.jsx";

export default function Header({session,token,userId,syncStatus,theme,onThemeChange,selected,onGoToToday,onGoHome,stravaConnected,onStravaChange}) {
  // Format selected date as "Mon, Mar 1" — the actual context anchor
  const [dateLabel, setDateLabel] = useState("");
  const [isToday, setIsToday] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const selDate = new Date(selected + "T12:00:00");
    const today = toKey(new Date());
    setIsToday(selected === today);
    setDateLabel(selDate.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric"
    }));
  }, [selected]);
  const isElectron = typeof window !== "undefined" && (!!window.daylabNative || !!window.dayloopNative);
  return (
    <div style={{
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 28px)",
      paddingLeft: 18, paddingRight: 14,
      paddingBottom: 10,
      flexShrink: 0,
      position: "sticky", top: 0, zIndex: 100,
      WebkitAppRegion: "drag", userSelect: "none",
    }}>
      {/* Pull-down overscroll patch */}
      <div style={{position:"fixed",top:"-100px",left:0,right:0,height:"100px",background:"var(--dl-bg)",zIndex:99}}/>
      {/* DAY LAB wordmark — full-width centered, click = go home */}
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        display: "flex", alignItems: "center", justifyContent: "center",
        paddingBottom: 6,
        WebkitAppRegion: "drag",
      }}>
        <button onClick={onGoHome} style={{
          background: "none", border: "none", padding: 0, cursor: "pointer",
          WebkitAppRegion: "no-drag",
        }}>
          <span style={{
            fontFamily: blurweb,
            fontSize: 22,
            letterSpacing: "normal",
            textTransform: "uppercase",
            color: "var(--dl-text)",
            userSelect: "none",
            lineHeight: 1,
            display: "block",
          }}>DAY LAB</span>
        </button>
      </div>

      {/* User menu — overlaid far right, same vertical band */}
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        height: 0,
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
        transform: "translateY(-36px)",
        WebkitAppRegion: "drag",
      }}>
        <div style={{WebkitAppRegion:"no-drag", position:"relative", zIndex:101}}>
          <UserMenu session={session} token={token} userId={userId} theme={theme} onThemeChange={onThemeChange} stravaConnected={stravaConnected} onStravaChange={onStravaChange}/>
        </div>
      </div>
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────
// Only truly special events belong on the month grid — not meals or daily tasks
