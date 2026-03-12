"use client";
import { createContext, useContext, useState, useEffect } from "react";
import { THEMES } from "./tokens.js";
const ThemeContext = createContext({ theme:"dark", setTheme:()=>{}, colors:THEMES.dark });
export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => { if(typeof window!=="undefined") return localStorage.getItem("theme")||"dark"; return "dark"; });
  useEffect(()=>{ localStorage.setItem("theme",theme); document.documentElement.setAttribute("data-theme",theme); },[theme]);
  return <ThemeContext.Provider value={{ theme, setTheme, colors: THEMES[theme]||THEMES.dark }}>{children}</ThemeContext.Provider>;
}
export function useTheme() { return useContext(ThemeContext); }
