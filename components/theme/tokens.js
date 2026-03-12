export const THEMES = {
  dark: {
    // 3 depth levels: bg (page) < surface/card (bars+cards) < well (inset inputs)
    // Direction: bg is medium-dark, surface is lighter, well is darkest
    bg:"#111110",      surface:"#1E1C1A",   card:"#1E1C1A",
    well:"#171614",    border:"#272422",    border2:"#333028",
    text:"#EFDFC3",    muted:"#9A9088",     dim:"#6A6258",
    accent:"#D08828",
    green:"#4A9A68",   blue:"#4878A8",
    purple:"#8860B8",  red:"#B04840",       orange:"#D08828",
    yellow:"#B88828",
    shadow:"0 1px 2px rgba(0,0,0,0.4),0 2px 8px rgba(0,0,0,0.18)",
    shadowSm:"0 1px 2px rgba(0,0,0,0.3)",
  },
  light: {
    // 3 depth levels: bg (page) < surface/card (bars+cards) < well (inset inputs)
    // Direction: bg slightly darker taupe, surface is the main cream, well is darkest
    bg:"#D4CCB8",      surface:"#EAE3D6",   card:"#EAE3D6",
    well:"#C8BCA8",    border:"#C8BEA8",    border2:"#B8AC98",
    text:"#3A2E22",    muted:"#7A6E66",     dim:"#9A9088",
    accent:"#B87018",
    green:"#38684A",   blue:"#386088",
    purple:"#604888",  red:"#843830",       orange:"#B87018",
    yellow:"#806818",
    shadow:"0 1px 3px rgba(36,24,12,0.10),0 2px 8px rgba(36,24,12,0.07)",
    shadowSm:"0 1px 2px rgba(36,24,12,0.08)",
  },
};
// C is set at render time via setTheme — default dark
// NOTE: C is intentionally a mutable module-level variable that is reassigned
// synchronously at the top of every render in Dashboard() via `C = THEMES[theme]`.
// This works because Dashboard is a single-instance client component (no SSR,
// no concurrent rendering). If this ever moves to SSR or concurrent mode, refactor
// to React context or pass C as a prop through the component tree.
let C = THEMES.dark;
export const serif   = "Georgia, 'Times New Roman', serif";
export const mono    = "'SF Mono', 'Fira Code', ui-monospace, monospace";
export const blurweb = "'BlurWeb', sans-serif";
function injectBlurWebFont() {
  if (typeof document === "undefined" || document.getElementById("blurweb-face")) return;
  const s = document.createElement("style");
  s.id = "blurweb-face";
  s.textContent = "@font-face { font-family: 'BlurWeb'; src: url('/fonts/BlurWeb-Medium.ttf') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }";
  document.head.appendChild(s);
}

export const F = { lg:18, md:15, sm:12 };
export const R = '16px';
