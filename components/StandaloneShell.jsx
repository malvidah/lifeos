"use client";
import { useState, useEffect } from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { mono, F, injectBlurWebFont } from "@/lib/tokens";
import { todayKey, shift, toKey } from "@/lib/dates";
import { api } from "@/lib/api";
import { NoteContext, ProjectNamesContext, PlaceNamesContext, NavigationContext } from "@/lib/contexts";
import { useStandalonePage } from "@/lib/useStandalonePage";
import { ToastContainer } from "./ui/Toast.jsx";
import LoginScreen from "./views/LoginScreen.jsx";

function stepDateKey(dateStr, delta) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtNavDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()}`;
}

// Minimal header with card name, back link, and date nav
function StandaloneHeader({ label, selected, setSelected }) {
  const today = todayKey();
  const isToday = selected === today;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '12px 16px', borderBottom: '1px solid var(--dl-border)',
      position: 'sticky', top: 0, zIndex: 100,
      background: 'var(--dl-bg)',
    }}>
      {/* Left: back link */}
      <a href="/" style={{
        fontFamily: mono, fontSize: F.sm, color: 'var(--dl-middle)',
        textDecoration: 'none', letterSpacing: '0.04em',
        display: 'flex', alignItems: 'center', gap: 4,
      }}>
        <span style={{ fontSize: 14 }}>&larr;</span> Dashboard
      </a>

      {/* Center: date nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button onClick={() => setSelected(stepDateKey(selected, -1))} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dl-highlight)', padding: '2px 6px', fontFamily: mono, fontSize: 18,
          lineHeight: 1, userSelect: 'none',
        }}>&lsaquo;</button>
        <button onClick={() => setSelected(isToday ? selected : today)} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          fontFamily: mono, fontSize: F.sm, letterSpacing: '0.04em',
          color: isToday ? 'var(--dl-accent)' : 'var(--dl-strong)',
          fontWeight: isToday ? 700 : 400,
        }}>{fmtNavDate(selected)}</button>
        <button onClick={() => setSelected(stepDateKey(selected, +1))} style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: 'var(--dl-highlight)', padding: '2px 6px', fontFamily: mono, fontSize: 18,
          lineHeight: 1, userSelect: 'none',
        }}>&rsaquo;</button>
      </div>

      {/* Right: label */}
      <span style={{
        fontFamily: mono, fontSize: F.sm, letterSpacing: '0.06em',
        textTransform: 'uppercase', color: 'var(--dl-middle)',
      }}>{label}</span>
    </div>
  );
}

function ShellInner({ label, children }) {
  const { authReady, session, token, userId, selected, setSelected } = useStandalonePage();

  useEffect(injectBlurWebFont, []);

  // Provide minimal context values so editors work
  const [projectNames, setProjectNames] = useState([]);
  const [placeNames, setPlaceNames] = useState([]);
  const [noteNames, setNoteNames] = useState([]);

  useEffect(() => {
    if (!token) return;
    api.get('/api/all-tags', token).then(d => {
      if (d?.tags) setProjectNames(d.tags);
    });
    api.get('/api/places', token).then(d => {
      setPlaceNames((d?.places ?? []).map(p => p.name));
    });
  }, [token]);

  if (!authReady) {
    return (
      <div style={{ background: 'var(--dl-bg)', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-highlight)', letterSpacing: '0.2em' }}>loading...</span>
      </div>
    );
  }

  if (!session) return <LoginScreen />;

  return (
    <ProjectNamesContext.Provider value={projectNames}>
    <PlaceNamesContext.Provider value={placeNames}>
    <NoteContext.Provider value={{ notes: noteNames, onCreateNote: (name) => {
      window.dispatchEvent(new CustomEvent('daylab:create-note', { detail: { name } }));
    }}}>
    <NavigationContext.Provider value={{
      navigateToProject: () => {},
      navigateToNote: () => {},
      navigateToPlace: () => {},
    }}>
    <ToastContainer />
    <div style={{ background: 'var(--dl-bg)', minHeight: '100vh', color: 'var(--dl-strong)', display: 'flex', flexDirection: 'column' }}>
      <StandaloneHeader label={label} selected={selected} setSelected={setSelected} />
      <div style={{ flex: 1, maxWidth: 800, width: '100%', margin: '0 auto', padding: 16 }}>
        {typeof children === 'function' ? children({ token, userId, selected, setSelected }) : children}
      </div>
    </div>
    </NavigationContext.Provider>
    </NoteContext.Provider>
    </PlaceNamesContext.Provider>
    </ProjectNamesContext.Provider>
  );
}

export default function StandaloneShell({ label, children }) {
  return (
    <ThemeProvider>
      <ShellInner label={label}>{children}</ShellInner>
    </ThemeProvider>
  );
}
