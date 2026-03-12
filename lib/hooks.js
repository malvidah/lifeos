"use client";
import { useState, useEffect } from "react";

export function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    setMobile(mq.matches);
    const handler = (e) => setMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return mobile;
}

export function useCollapse(key, defaultCollapsed = false) {
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return defaultCollapsed;
    const saved = localStorage.getItem(`collapse:${key}`);
    return saved !== null ? saved === "true" : defaultCollapsed;
  });
  const toggle = () => setCollapsed(prev => {
    const next = !prev;
    localStorage.setItem(`collapse:${key}`, String(next));
    return next;
  });
  return [collapsed, toggle];
}
