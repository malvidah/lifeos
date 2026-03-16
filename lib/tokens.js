// ─── Shared design tokens ─────────────────────────────────────────────────────
// Non-color constants only. All colors live in theme.css as --dl-* CSS vars.

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
// These are accent colors for projects and are intentionally theme-independent.

const PROJECT_PALETTE = [
  '#C17B4A', '#7A9E6E', '#6B8EB8', '#A07AB0',
  '#B08050', '#5E9E8A', '#B06878', '#8A8A50',
];

// projectColor(name, override?) — returns a project's display color.
export function projectColor(name, override) {
  if (override) return override;
  let h = 0;
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}

// ─── Chip style tokens ────────────────────────────────────────────────────────
// Shared inline-style objects for TagChip (project) and NoteChip (note link).
// Uses CSS vars so colors adapt to dark/light theme automatically.

export const CHIP_TOKENS = {
  project: (col) => ({
    display: 'inline-block', verticalAlign: 'middle',
    color: col, background: col + '22', borderRadius: '999px',
    padding: '1px 7px', fontFamily: mono, fontSize: '11px',
    letterSpacing: '0.08em', lineHeight: '1.65',
    textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
  }),
  note: {
    display: 'inline-block', verticalAlign: 'middle',
    color: 'var(--dl-strong)', background: 'var(--dl-border)', borderRadius: '4px',
    padding: '1px 7px', fontFamily: mono, fontSize: '11px',
    letterSpacing: '0.08em', lineHeight: '1.65',
    textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
  },
  date: (col) => ({
    display: 'inline-block', verticalAlign: 'middle',
    color: col, background: col + '22', borderRadius: '999px',
    padding: '1px 7px', fontFamily: mono, fontSize: '11px',
    letterSpacing: '0.08em', lineHeight: '1.65',
    textTransform: 'uppercase', whiteSpace: 'nowrap', flexShrink: 0,
  }),
};
