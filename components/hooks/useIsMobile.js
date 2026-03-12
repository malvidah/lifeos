import { useState, useEffect } from "react";
export function useIsMobile() {
  const [mobile, setMobile] = useState(false); // always false on SSR
  useEffect(() => {
    let t;
    const fn = () => { clearTimeout(t); t = setTimeout(() => setMobile(window.innerWidth < 768), 150); };
    setMobile(window.innerWidth < 768); // immediate on mount, no debounce
    window.addEventListener("resize", fn);
    return () => { window.removeEventListener("resize", fn); clearTimeout(t); };
  }, []);
  return mobile;
}
