// ─── Shared design tokens ─────────────────────────────────────────────────────
// Single source of truth for all visual constants across the app.
// DayLabEditor.jsx imports from here (not the other way around).

export const THEMES = {
  dark: {
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

export const serif   = "Georgia, 'Times New Roman', serif";
export const mono    = "'SF Mono', 'Fira Code', ui-monospace, monospace";
export const blurweb = "'BlurWeb', sans-serif";

export const F = { lg:18, md:15, sm:12 };
export const R = '16px';

export function injectBlurWebFont() {
  if (typeof document === "undefined" || document.getElementById("blurweb-face")) return;
  const s = document.createElement("style");
  s.id = "blurweb-face";
  s.textContent = "@font-face { font-family: 'BlurWeb'; src: url('/fonts/BlurWeb-Medium.ttf') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }";
  document.head.appendChild(s);
}

// ─── Project color palette ────────────────────────────────────────────────────
// Deterministic color from a project name — same hash used everywhere.

const PROJECT_PALETTE = [
  '#C17B4A', '#7A9E6E', '#6B8EB8', '#A07AB0',
  '#B08050', '#5E9E8A', '#B06878', '#8A8A50',
];

// projectColor(name, override?) — returns a project's display color.
// If `override` is provided (e.g. from the projects DB table), it takes priority.
// Falls back to a deterministic palette hash so every project always has a color.
export function projectColor(name, override) {
  if (override) return override;
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

// ─── Chip style tokens ────────────────────────────────────────────────────────
// Shared inline-style objects for TagChip (project) and NoteChip (note link).
// Used in primitives.jsx, DayLabEditor.jsx, and TipTap node renderers.

export const CHIP_TOKENS = {
  project: (col) => ({
    display: 'inline-block', verticalAlign: 'middle',
    color: col, background: col + '22', borderRadius: '5px',
    padding: '1px 7px', fontFamily: mono, fontSize: '11px',
    letterSpacing: '0.08em', lineHeight: '1.65',
    textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
  }),
  note: {
    display: 'inline-block', verticalAlign: 'middle',
    color: THEMES.dark.accent, background: THEMES.dark.accent + '1a', borderRadius: '5px',
    padding: '1px 7px', fontFamily: mono, fontSize: '11px',
    letterSpacing: '0.08em', lineHeight: '1.65',
    textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
  },
};
