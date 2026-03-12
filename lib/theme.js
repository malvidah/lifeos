"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { THEMES } from "./tokens.js";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("theme") || "dark";
    return "dark";
  });
  const C = THEMES[theme] || THEMES.dark;

  useEffect(() => {
    localStorage.setItem("theme", theme);
    document.documentElement.style.background = C.bg;
    document.body.style.background = C.bg;
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  }, [theme, C.bg]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, C }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
