import { useState } from "react";
export function useCollapse(key, defaultCollapsed=false) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const stored = localStorage.getItem(`collapse:${key}`);
    return stored !== null ? stored === "1" : defaultCollapsed;
  });
  const toggle = () => setCollapsed(v => {
    const next = !v;
    localStorage.setItem(`collapse:${key}`, next ? "1" : "0");
    return next;
  });
  return [collapsed, toggle];
}
