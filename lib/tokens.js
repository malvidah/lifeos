// ─── Shared design tokens ─────────────────────────────────────────────────────
// Single source of truth for all visual constants across the app.
// DayLabEditor.jsx imports from here (not the other way around).

export const THEMES = {
  // ── Dark ── 4 contrast levels (warm near-black → card → secondary → cream) ──
  // DARKEST : bg, well (insets, selected note bg, checked task bg)
  // DARK    : card / surface  (cards float clearly above the page)
  // DIM     : dim / muted     (placeholder text, secondary labels, unfocused icons)
  // BRIGHT  : text / accent   (entered text, focused selection, active icons)
  dark: {
    bg:"#111110",      surface:"#161311",   card:"#161311",
    well:"#0D0C0B",    border:"#1F1C18",    border2:"#2A2720",
    text:"#F2E0C8",    muted:"#9A8E80",     dim:"#60564E",
    accent:"#D08828",
    green:"#4A9A68",   blue:"#4878A8",
    purple:"#8860B8",  red:"#B04840",       orange:"#D08828",
    yellow:"#B88828",
    shadow:"0 1px 3px rgba(0,0,0,0.55),0 2px 12px rgba(0,0,0,0.28)",
    shadowSm:"0 1px 2px rgba(0,0,0,0.40)",
  },
  // ── Light ── inverted hierarchy (cream card → tan page → medium → dark brown) ─
  // BRIGHT  : card / surface  (cards lift above page)
  // DARK bg : bg / well       (page bg, insets sit slightly below)
  // DIM     : dim             (placeholder text, ghost labels)
  // DARKEST : text            (primary text, maximum contrast)
  light: {
    bg:"#D4CCB8",      surface:"#E4DCC8",   card:"#E4DCC8",
    well:"#C8C0AA",    border:"#C0B89C",    border2:"#B0A88C",
    text:"#26201A",    muted:"#78706A",     dim:"#9C9488",
    accent:"#B87018",
    green:"#38684A",   blue:"#386088",
    purple:"#604888",  red:"#843830",       orange:"#B87018",
    yellow:"#806818",
    shadow:"0 1px 3px rgba(36,24,12,0.13),0 2px 10px rgba(36,24,12,0.09)",
    shadowSm:"0 1px 2px rgba(36,24,12,0.10)",
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
