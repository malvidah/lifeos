"use client";
import { createContext, useContext, useState, useEffect, useRef } from "react";
import { getDayPhase, getUserLocation } from "@/lib/weather";

// Bg values used only for the DOM background update on theme change.
// Colors live in theme.css as CSS custom properties (--dl-*).
const BG = { dark: "#0E0D0C", light: "#EFEBE4" };

const ThemeContext = createContext(null);

// Resolve "auto" to "light" or "dark" based on sun position
function resolveAuto(lat, lng) {
  const { light } = getDayPhase(new Date(), lat, lng);
  return light > 0.5 ? "light" : "dark";
}

export function ThemeProvider({ children }) {
  const [preference, setPreference] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("theme") || "auto";
    return "auto";
  });

  // Effective theme: what's actually applied ("light" or "dark")
  const [effective, setEffective] = useState(() => {
    if (preference !== "auto") return preference;
    // On first render, guess from hour (location not yet available)
    if (typeof window === "undefined") return "dark";
    const hour = new Date().getHours();
    return (hour >= 6 && hour < 19) ? "light" : "dark";
  });

  const locationRef = useRef(null);

  // Load location and start auto-update loop
  useEffect(() => {
    if (preference !== "auto") {
      setEffective(preference);
      return;
    }

    let interval;
    let mounted = true;

    getUserLocation().then(loc => {
      if (!mounted) return;
      locationRef.current = loc;
      setEffective(resolveAuto(loc.lat, loc.lng));

      // Re-check every 60 seconds
      interval = setInterval(() => {
        if (locationRef.current) {
          setEffective(resolveAuto(locationRef.current.lat, locationRef.current.lng));
        }
      }, 60_000);
    });

    return () => { mounted = false; clearInterval(interval); };
  }, [preference]);

  // Apply effective theme to DOM
  useEffect(() => {
    const bg = BG[effective] ?? BG.dark;
    localStorage.setItem("theme", preference); // store preference, not effective
    document.documentElement.setAttribute("data-theme", effective);
    document.documentElement.style.background = bg;
    document.body.style.background = bg;
    document.documentElement.style.colorScheme = effective === "light" ? "light" : "dark";

    // Enable smooth transitions after first paint so initial load stays instant.
    // Clear the !important inline styles from THEME_SCRIPT so CSS transitions
    // can take effect — the data-theme attribute + CSS vars handle colors now.
    if (!document.documentElement.classList.contains("theme-ready")) {
      requestAnimationFrame(() => {
        document.documentElement.style.removeProperty("background");
        document.documentElement.style.removeProperty("background-color");
        if (document.body) {
          document.body.style.removeProperty("background");
          document.body.style.removeProperty("background-color");
        }
        document.documentElement.classList.add("theme-ready");
      });
    }
  }, [effective, preference]);

  return (
    <ThemeContext.Provider value={{ theme: effective, preference, setTheme: setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
