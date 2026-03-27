"use client";
import { useState, useEffect } from "react";
import { ThemeProvider, useTheme } from "@/lib/theme";
import { mono, F, injectBlurWebFont } from "@/lib/tokens";
import { todayKey } from "@/lib/dates";
import { api } from "@/lib/api";
import { NoteContext, ProjectNamesContext, PlaceNamesContext, NavigationContext } from "@/lib/contexts";
import { useStandalonePage } from "@/lib/useStandalonePage";
import { ToastContainer } from "./ui/Toast.jsx";
import LoginScreen from "./views/LoginScreen.jsx";
import Header from "./nav/Header.jsx";

function ShellInner({ label, children }) {
  const { theme, preference, setTheme } = useTheme();
  const { authReady, session, token, userId, selected, setSelected } = useStandalonePage();
  const [stravaConnected, setStravaConnected] = useState(false);

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
    // Check strava connection status
    api.get('/api/settings', token).then(d => {
      if (d?.settings?.strava_connected) setStravaConnected(true);
    }).catch(() => {});
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
      <Header
        session={session} token={token} userId={userId}
        theme={theme} themePreference={preference} onThemeChange={setTheme}
        selected={selected} onSelectDate={setSelected}
        onGoToToday={() => setSelected(todayKey())}
        onGoHome={() => setSelected(todayKey())}
        stravaConnected={stravaConnected} onStravaChange={setStravaConnected}
      />
      {/* Spacer for fixed header */}
      <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 84px)', flexShrink: 0 }} />
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
