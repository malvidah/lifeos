"use client";
import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { DayLabEditor } from './DayLabEditor.jsx';
import { createClient } from "../lib/supabase.js";


const THEMES = {
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
const serif   = "Georgia, 'Times New Roman', serif";
const mono    = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const blurweb = "'BlurWeb', sans-serif";
function injectBlurWebFont() {
  if (typeof document === "undefined" || document.getElementById("blurweb-face")) return;
  const s = document.createElement("style");
  s.id = "blurweb-face";
  s.textContent = "@font-face { font-family: 'BlurWeb'; src: url('/fonts/BlurWeb-Medium.ttf') format('truetype'); font-weight: normal; font-style: normal; font-display: swap; }";
  document.head.appendChild(s);
}
const F     = { lg:18, md:15, sm:12 }; // 3 sizes only

// ─── Responsive hook ──────────────────────────────────────────────────────────
function useIsMobile() {
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


const R = "16px";

const toKey = d => {
  const dt = d instanceof Date ? d : new Date(d);
  // Use local date parts — toISOString() gives UTC which is wrong for US timezones at night
  return [dt.getFullYear(), String(dt.getMonth()+1).padStart(2,"0"), String(dt.getDate()).padStart(2,"0")].join("-");
};
const todayKey = () => toKey(new Date());
const shift    = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };

// ─── Projects — tag parsing & rendering ──────────────────────────────────────
function extractTags(text) {
  if (!text || typeof text !== 'string') return [];
  // Require a non-word char (space, punctuation, EOL) after the tag so
  // partial words mid-typing don't create spurious projects.
  // Keep original case — dedup is handled case-insensitively at the project level.
  const re = /#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9])/g;
  const tags = []; const seenLower = new Set(); let m;
  while ((m = re.exec(text)) !== null) {
    const lower = m[1].toLowerCase();
    if (!seenLower.has(lower)) { seenLower.add(lower); tags.push(m[1]); }
  }
  return tags;
}
function extractTagsFromAll(notes, tasks) {
  const tags = new Set();
  extractTags(notes || '').forEach(t => tags.add(t));
  (Array.isArray(tasks) ? tasks : []).forEach(task => {
    if (task?.text) extractTags(task.text).forEach(t => tags.add(t));
  });
  return [...tags];
}
// BigThink → Big Think  (used for project-level labels, not inline chips)
// Also handles all-lowercase normalized tags: 'daylab' → 'Daylab'
function tagDisplayName(name) {
  // camelCase split (legacy mixed-case keys like 'BigThink' → 'Big Think')
  const spaced = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
  // Capitalize first letter of each word
  return spaced.replace(/\b\w/g, c => c.toUpperCase());
}
// Pastel accent palette for project chips — warm tones that fit the dark theme
const PROJECT_PALETTE = [
  '#C17B4A', // warm terracotta
  '#7A9E6E', // sage green
  '#6B8EB8', // dusty blue
  '#A07AB0', // muted lavender
  '#B08050', // warm sand
  '#5E9E8A', // teal
  '#B06878', // dusty rose
  '#8A8A50', // olive
];
// Deterministic color from project name (stable across sessions)
function projectColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_PALETTE[h % PROJECT_PALETTE.length];
}
function TagChip({ name, onClick, style={}, plain=false }) {
  const col = projectColor(name);
  if (plain) {
    // Project's own tag: same chip but dimmed, no hover
    return (
      <span
        style={{
          display:'inline-flex', alignItems:'center',
          background: col + '10',
          border: `1px solid ${col}25`,
          borderRadius: 4, padding: '0 5px',
          fontSize: '0.82em', color: col + '55',
          fontFamily: mono, lineHeight: '1.6',
          flexShrink: 0, verticalAlign: 'middle',
          cursor: 'default', opacity: 0.5,
          ...style,
        }}
      >#{name}</span>
    );
  }
  return (
    <span
      onClick={onClick}
      style={{
        display:'inline-flex', alignItems:'center',
        background: col + '20',
        border: `1px solid ${col}40`,
        borderRadius: 4, padding: '0 5px',
        fontSize: '0.82em', color: col,
        fontFamily: mono, lineHeight: '1.6',
        flexShrink: 0, verticalAlign: 'middle',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'opacity 0.15s',
        ...style,
      }}
    >#{name}</span>
  );
}
// Edit-mode tag renderer: colored #tag spans (no chip pill), consistent with Notes focused renderInline.
// Used in task edit overlay and any other edit context across the app.
function renderTaskInline(text) {
  if (!text) return null;
  const re = /(#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9]))/g;
  const parts = []; let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, m.index)}</Fragment>);
    const col = projectColor(m[2]);
    parts.push(<span key={`c${m.index}`} style={{ color: col, fontFamily: 'inherit' }}>{m[1]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={`e${last}`}>{text.slice(last)}</Fragment>);
  return parts.length ? parts : text;
}

function renderWithTags(text, dimTag=null, onTagClick=null) {
  if (!text) return null;
  const parts = []; let last = 0;
  const re = /#([A-Za-z][A-Za-z0-9]+)/g; let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={`t${last}`}>{text.slice(last, m.index)}</Fragment>);
    const isOwn = dimTag && m[1].toLowerCase() === dimTag.toLowerCase();
    parts.push(<TagChip key={`c${m.index}`} name={m[1]} plain={isOwn}/>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={`e${last}`}>{text.slice(last)}</Fragment>);
  return parts.length > 0 ? parts : text;
}


// ─── URL + Image rendering helpers ──────────────────────────────────────────
const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;
const IMG_RE = /\[img:(https?:\/\/[^\]]+|data:[^\]]+)\]/g;

// Split text by images first, then render each text segment with URLs+tags
function renderRichLine(text, dimTag=null, onTagClick=null) {
  if (!text) return null;
  const parts = [];
  let last = 0;
  const re = new RegExp(IMG_RE.source, 'g'); let m;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      parts.push(<span key={`t${last}`}>{renderTextWithLinksAndTags(text.slice(last, m.index), dimTag, last, onTagClick)}</span>);
    }
    parts.push(
      <div key={`img${m.index}`} style={{ margin: '6px 0', lineHeight: 0 }}>
        <img src={m[1]} alt="" style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 8, display: 'block' }} />
      </div>
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={`e${last}`}>{renderTextWithLinksAndTags(text.slice(last), dimTag, last, onTagClick)}</span>);
  return parts.length ? parts : renderTextWithLinksAndTags(text, dimTag, 0, onTagClick);
}

function renderTextWithLinksAndTags(text, dimTag=null, keyOffset=0, onTagClick=null) {
  if (!text) return null;
  // Build a combined regex for URLs and #tags
  const combined = /(https?:\/\/[^\s<>"')\]]+)|(#([A-Za-z][A-Za-z0-9]+)(?![A-Za-z0-9]))/g;
  const parts = []; let last = 0; let m;
  while ((m = combined.exec(text)) !== null) {
    if (m.index > last) parts.push(<Fragment key={`${keyOffset}t${last}`}>{text.slice(last, m.index)}</Fragment>);
    if (m[1]) {
      // URL
      const url = m[1];
      parts.push(
        <a key={`${keyOffset}u${m.index}`} href={url} target="_blank" rel="noreferrer"
          style={{ color: '#C8820A', textDecoration: 'none', transition: 'color 0.15s', pointerEvents: 'auto' }}
          onMouseEnter={e => e.currentTarget.style.color = '#F5A623'}
          onMouseLeave={e => e.currentTarget.style.color = '#C8820A'}
        >{url}</a>
      );
    } else {
      // #tag
      const isOwn = dimTag && m[3].toLowerCase() === dimTag.toLowerCase();
      parts.push(<TagChip key={`${keyOffset}c${m.index}`} name={m[3]} plain={isOwn}/>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<Fragment key={`${keyOffset}e${last}`}>{text.slice(last)}</Fragment>);
  return parts.length ? parts : text;
}

// Client-side image resize+compress before upload
async function resizeImage(file, maxW=1200, quality=0.82) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      canvas.toBlob(blob => {
        const reader = new FileReader();
        reader.onload = () => resolve({ base64: reader.result.split(',')[1], mimeType: 'image/jpeg' });
        reader.readAsDataURL(blob);
      }, 'image/jpeg', quality);
    };
    img.src = url;
  });
}

async function uploadImageFile(file, token) {
  const { base64, mimeType } = await resizeImage(file);
  const res = await fetch('/api/upload-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: base64, mimeType, filename: file.name }),
  });
  const d = await res.json();
  return d.url || null;
}

// ─── AI ───────────────────────────────────────────────────────────────────────
async function estimateNutrition(prompt, token) {
  if (!token) return null;
  try {
    const r = await fetch("/api/ai",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({model:"claude-haiku-4-5-20251001",max_tokens:80,
        system:"Return ONLY a valid JSON object with the requested integer fields. No explanation, no markdown, no backticks.",
        messages:[{role:"user",content:prompt}]})});
    const d = await r.json();
    if (d.error) return null;
    const text = d.content?.find(b=>b.type==="text")?.text||"{}";
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
    if (!parsed.kcal) return null;
    return parsed; // {kcal, protein} for meals, {kcal} for activities
  } catch { return null; }
}

// ─── Oura response cache (per date+user, avoids double-fetching) ─────────────
const _ouraCache = {};
function ouraKey(userId, date) { return `${userId}|${date}`; }
function cachedOuraFetch(date, token, userId) {
  const k = ouraKey(userId, date);
  if (_ouraCache[k]) return _ouraCache[k];
  // Pass timezone offset so server computes the correct local "today"
  const tzOffset = new Date().getTimezoneOffset() * -1; // minutes, e.g. -480 for PST
  const p = fetch(`/api/oura?date=${date}&tzOffset=${tzOffset}`,{headers:{Authorization:`Bearer ${token}`}})
    .then(r=>r.json())
    .then(data => {
      // Don't cache error or empty responses — retry on next access
      const hasData = data && !data.error && Object.keys(data).length > 0;
      if (!hasData) delete _ouraCache[k];
      return data;
    })
    .catch(()=>{ delete _ouraCache[k]; return {}; });
  _ouraCache[k] = p;
  // Expire after 5 minutes
  setTimeout(()=>{ delete _ouraCache[k]; }, 5 * 60 * 1000);
  return p;
}

// ─── DB ───────────────────────────────────────────────────────────────────────
async function dbSave(date,type,data,token) {
  if (!token) return;
  const url="/api/entries";
  const body=JSON.stringify({date,type,data});
  const headers={"Content-Type":"application/json","Authorization":`Bearer ${token}`};
  // sendBeacon is fire-and-forget and survives iOS page suspension
  // We encode auth in the body since Beacon can't set custom headers
  try {
    await fetch(url,{method:"POST",headers,body});
  } catch(e) {
    // Fallback: sendBeacon (no custom headers, but works during suspension)
    if (navigator.sendBeacon) {
      const blob = new Blob([body],{type:"application/json"});
      navigator.sendBeacon(url+"?token="+encodeURIComponent(token), blob);
    }
  }
}
async function dbLoad(date,type,token) {
  if (!token) return null;
  try {
    const r = await fetch(`/api/entries?date=${date}&type=${type}`,{headers:{"Authorization":`Bearer ${token}`}});
    if (!r.ok) return null;
    return (await r.json()).data ?? null;
  } catch { return null; }
}
// Module-level cache — keyed by "userId:date:type" to prevent cross-user bleed
const MEM = {};
const DIRTY = {};
let CURRENT_USER_ID = null;

// ─── Global undo/redo history ────────────────────────────────────────────────
// Each entry: { label, undo: fn, redo: fn }
const HISTORY = { stack: [], cursor: -1 };
function pushHistory(entry) {
  // Drop any redo tail
  HISTORY.stack = HISTORY.stack.slice(0, HISTORY.cursor + 1);
  HISTORY.stack.push(entry);
  if (HISTORY.stack.length > 60) HISTORY.stack.shift();
  HISTORY.cursor = HISTORY.stack.length - 1;
}
function canUndo() { return HISTORY.cursor >= 0; }
function canRedo() { return HISTORY.cursor < HISTORY.stack.length - 1; }
async function doUndo() { if (canUndo()) { await HISTORY.stack[HISTORY.cursor].undo(); HISTORY.cursor--; } }
async function doRedo() { if (canRedo()) { HISTORY.cursor++; await HISTORY.stack[HISTORY.cursor].redo(); } }

// Call this when auth state changes — wipes cache for previous user
function clearCacheForUser(newUserId) {
  if (CURRENT_USER_ID && CURRENT_USER_ID !== newUserId) {
    // Different user logged in — purge everything
    for (const k of Object.keys(MEM)) delete MEM[k];
    for (const k of Object.keys(DIRTY)) delete DIRTY[k];
  }
  CURRENT_USER_ID = newUserId;
}

function useDbSave(date, type, empty, token, userId) {
  // Include userId in cache key so different users never share cache entries
  const cacheKey = `${userId||"anon"}:${date}:${type}`;
  const prevCacheKey = useRef(cacheKey);
  const [value, _set] = useState(() => MEM[cacheKey] ?? empty);
  const [loaded, setLoaded] = useState(cacheKey in MEM);
  const [rev, setRev] = useState(0);
  const live = useRef(value);
  const dateRef = useRef(date);
  const timerRef = useRef(null);
  live.current = value;

  // When date changes the cacheKey changes — immediately show empty/cached value
  // so the previous date's data is never visible on the new date
  if (prevCacheKey.current !== cacheKey) {
    prevCacheKey.current = cacheKey;
    const next = MEM[cacheKey] ?? empty;
    live.current = next;
    _set(next);
    setLoaded(cacheKey in MEM);
  }

  // Listen for external refresh events (e.g. from voice input)
  useEffect(() => {
    const handler = (e) => {
      if (!e.detail?.types || e.detail.types.includes(type)) {
        // Clear cache so we get fresh DB data
        delete MEM[cacheKey];
        delete DIRTY[cacheKey];
        setRev(r => r + 1);
      }
    };
    // Sync from sibling hook instances that wrote to the same cache key
    const memHandler = (e) => {
      if (e.detail?.key === cacheKey && e.detail.value !== live.current) {
        live.current = e.detail.value;
        _set(e.detail.value);
      }
    };
    window.addEventListener('lifeos:mem-update', memHandler);
    window.addEventListener('lifeos:refresh', handler);
    // Restore snapshot (from undo of AI entry)
    const restoreHandler = (e) => {
      if (e.detail?.keys?.includes(cacheKey)) {
        const restored = MEM[cacheKey];
        if (restored !== undefined) { live.current = restored; _set(restored); }
      }
    };
    window.addEventListener('lifeos:snapshot-restore', restoreHandler);
    return () => { window.removeEventListener('lifeos:mem-update', memHandler); window.removeEventListener('lifeos:refresh', handler); window.removeEventListener('lifeos:snapshot-restore', restoreHandler); };
  }, [type, cacheKey]);

  // Fetch from DB whenever date/type/token/userId changes, or rev bumps (poll/visibility)
  useEffect(() => {
    if (!token || !userId) return;
    dateRef.current = date;
    // Use cache only for initial render (rev===0) when data is clean
    if (rev === 0 && cacheKey in MEM && !DIRTY[cacheKey]) {
      _set(MEM[cacheKey]); live.current = MEM[cacheKey]; setLoaded(true); return;
    }
    // Always fetch from DB on rev bump or dirty state
    dbLoad(date, type, token).then(remote => {
      if (DIRTY[cacheKey]) {
        // User has typed since we started fetching — last local write wins, don't overwrite
        // But save immediately to push local to DB
        dbSave(date, type, live.current, token);
        DIRTY[cacheKey] = false;
      } else {
        // No local changes — accept DB value authoritatively
        const val = remote ?? empty;
        MEM[cacheKey] = val; _set(val); live.current = val;
      }
      setLoaded(true);
    }).catch(() => setLoaded(true)); // on error, show what we have
  }, [date, type, token, userId, rev]); // eslint-disable-line

  useEffect(() => {
    if (!token) return;
    const flush = () => {
      clearTimeout(timerRef.current);
      if (DIRTY[cacheKey]) {
        dbSave(dateRef.current, type, live.current, token);
        DIRTY[cacheKey] = false;
      }
    };
    const onVis = () => {
      if (document.hidden) {
        flush(); // leaving — save immediately
      } else {
        flush(); // returning — save then re-fetch
        setRev(r => r + 1);
      }
    };
    const onPageHide = () => flush();
    // Poll every 5min passively — only if no local dirty changes
    // (single-user app; visibility flush + beforeunload cover real-time needs)
    const poll = setInterval(() => {
      if (!DIRTY[cacheKey]) setRev(r => r + 1);
    }, 5 * 60 * 1000);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("pagehide", onPageHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("pagehide", onPageHide);
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(poll);
    };
  }, [type, token, cacheKey]); // eslint-disable-line

  const setValue = useCallback((u, {undoLabel, skipHistory} = {}) => {
    const prev = live.current;
    const next = typeof u === "function" ? u(live.current) : u;
    live.current = next;
    MEM[cacheKey] = next;
    DIRTY[cacheKey] = true;
    _set(next);
    // Notify sibling hook instances with the same cacheKey
    window.dispatchEvent(new CustomEvent('lifeos:mem-update', { detail: { key: cacheKey, value: next } }));
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      dbSave(dateRef.current, type, live.current, token);
      DIRTY[cacheKey] = false;
    }, 200);
    // Push undo entry for meaningful edits (not AI calorie estimates, not loading)
    if (!skipHistory && undoLabel) {
      pushHistory({
        label: undoLabel,
        undo: () => {
          live.current = prev; MEM[cacheKey] = prev; DIRTY[cacheKey] = true; _set(prev);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { dbSave(dateRef.current, type, prev, token); DIRTY[cacheKey] = false; }, 200);
        },
        redo: () => {
          live.current = next; MEM[cacheKey] = next; DIRTY[cacheKey] = true; _set(next);
          clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { dbSave(dateRef.current, type, next, token); DIRTY[cacheKey] = false; }, 200);
        },
      });
    }
  }, [type, token, cacheKey]); // eslint-disable-line

  return { value, setValue, loaded };
}

// ─── useCollapse — localStorage-backed collapse state ────────────────────────
function useCollapse(key, defaultCollapsed=false) {
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

// ─── ChevronBtn — small collapse toggle ──────────────────────────────────────
function ChevronBtn({collapsed, onToggle, style={}}) {
  return (
    <button onClick={onToggle} style={{
      background:"none",border:"none",cursor:"pointer",padding:"2px 4px",
      color:C.dim,display:"flex",alignItems:"center",justifyContent:"center",
      flexShrink:0,transition:"color 0.15s",...style,
    }}
      onMouseEnter={e=>e.currentTarget.style.color=C.muted}
      onMouseLeave={e=>e.currentTarget.style.color=C.dim}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        {collapsed
          ? <polyline points="6 9 12 15 18 9"/>
          : <polyline points="18 15 12 9 6 15"/>}
      </svg>
    </button>
  );
}

// ─── Ring ─────────────────────────────────────────────────────────────────────
function Ring({score,color,size=48}) {
  const r=(size-7)/2, circ=2*Math.PI*r;
  const val=parseFloat(score)||0;
  const pct=Math.min(val/100,1);
  // Bubble grows from r×0.5 at score 0 → r×1 at score 85, then stays full
  const bubbleR = score ? r * Math.min(0.5 + 0.5*(val/85), 1.0) : 0;
  return (
    <svg width={size} height={size} style={{flexShrink:0}}>
      {/* Pastel fill bubble — scales with score */}
      <circle cx={size/2} cy={size/2} r={bubbleR}
        fill={color+"28"}
        style={{transition:"r 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      {/* Track ring */}
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color+"30"} strokeWidth={2.5}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%"}}/>
      {/* Progress arc */}
      <circle cx={size/2} cy={size/2} r={r} fill="none"
        stroke={color} strokeWidth={2.5} strokeLinecap="round"
        strokeDasharray={`${pct*circ} ${circ}`}
        style={{transform:"rotate(-90deg)",transformOrigin:"50% 50%",
          transition:"stroke-dasharray 0.5s cubic-bezier(.4,0,.2,1)"}}/>
      {/* Score label — color-tinted, not plain text */}
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        style={{fill:score?color:C.dim,fontSize:F.sm,fontFamily:mono,
          letterSpacing:"-0.02em"}}>
        {score||"—"}
      </text>
    </svg>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
function Card({children,style={},fitContent=false}) {
  return (
    <div style={{
      background:C.card,borderRadius:R,border:`1px solid ${C.border}`,
      overflow:"clip",height:fitContent?"auto":"100%",
      display:"flex",flexDirection:"column",
      ...style,
    }}>{children}</div>
  );
}



// ─── Widget card ─────────────────────────────────────────────────────────────
function Widget({label,color,children,slim,collapsed,onToggle,headerRight,headerLeft,autoHeight}) {
  const useAutoHeight = autoHeight || (!onToggle && !collapsed);
  return (
    <div style={slim ? {} : {flex:useAutoHeight?"0 0 auto":1,display:"flex",flexDirection:"column"}}>
      <Card style={(collapsed || useAutoHeight) ? {height:"auto"} : {flex:1}}>
        <div style={{
          display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
          borderBottom:collapsed?"none":`1px solid ${C.border}`,flexShrink:0,
          cursor:onToggle?"pointer":"default",
        }} onClick={onToggle}>
          {headerLeft}
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
            textTransform:"uppercase",color:C.muted,flex:1}}>{label}</span>
          {!collapsed && headerRight}
        </div>
        {!collapsed&&(
          <div style={slim ? {padding:"14px 16px"} : {flex:1,overflow:"auto",padding:16,minHeight:0}}>{children}</div>
        )}
      </Card>
    </div>
  );
}

// ─── UserMenu ─────────────────────────────────────────────────────────────────
function InfoTip({text}) {
  const [show,setShow]=useState(false);
  const [above,setAbove]=useState(false);
  const btnRef=useRef(null);
  function handleShow(){
    if(btnRef.current){
      const rect=btnRef.current.getBoundingClientRect();
      setAbove(rect.top>160);
    }
    setShow(true);
  }
  return (
    <span style={{position:"relative",display:"inline-flex",alignItems:"center"}}>
      <button
        ref={btnRef}
        onMouseEnter={handleShow} onMouseLeave={()=>setShow(false)}
        onFocus={handleShow} onBlur={()=>setShow(false)}
        style={{
          width:14,height:14,borderRadius:"50%",border:`1px solid ${C.border2}`,
          background:"none",cursor:"pointer",padding:0,
          display:"flex",alignItems:"center",justifyContent:"center",
          color:C.dim,fontFamily:mono,fontSize:F.sm,lineHeight:1,flexShrink:0,
        }}
        aria-label="More info"
      >i</button>
      {show&&(
        <div style={{
          position:"absolute",
          ...(above
            ? {bottom:"calc(100% + 6px)"}
            : {top:"calc(100% + 6px)"}),
          right:"-4px",
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:6,
          padding:"8px 10px",width:190,
          fontFamily:mono,fontSize:F.sm,color:C.muted,lineHeight:1.5,
          zIndex:500,boxShadow:C.shadow,pointerEvents:"none",
          whiteSpace:"normal",
        }}>
          {text}
        </div>
      )}
    </span>
  );
}

function IntegrationToggle({on, onOn, onOff, pending}) {
  const bg = on
    ? `rgba(196,168,130,0.15)`
    : pending
      ? `rgba(208,136,40,0.18)`
      : `rgba(155,107,58,0.08)`;
  const dot = on ? C.accent : pending ? C.accent : C.dim;
  const borderColor = pending ? `${C.accent}70` : C.border2;
  return (
    <button
      onClick={on ? onOff : onOn}
      style={{
        background: bg,
        border: `1px solid ${borderColor}`, borderRadius: 20, cursor: "pointer",
        padding: 3, display: "flex", alignItems: "center", width: 40, height: 22,
        justifyContent: on ? "flex-end" : "flex-start", flexShrink: 0,
        transition: "all 0.2s",
      }}>
      <div style={{width:14,height:14,borderRadius:"50%",background:dot,transition:"all 0.2s"}}/>
    </button>
  );
}

function IntegrationRow({label, subtitle, connected, onToggleOn, onToggleOff, children, pendingToggle}) {
  return (
    <div>
      <div style={{display:"flex",alignItems:"center",gap:8,paddingTop:1}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,flexShrink:0}}>
          {label}
        </span>
        {children}
        <div style={{marginLeft:"auto",flexShrink:0}}>
          <IntegrationToggle on={connected} onOn={onToggleOn} onOff={onToggleOff} pending={pendingToggle}/>
        </div>
      </div>
      {subtitle && (
        <div style={{fontFamily:mono,fontSize:9,color:C.dim,letterSpacing:"0.03em",marginTop:3}}>
          — {subtitle}
        </div>
      )}
    </div>
  );
}

function UserMenu({session,token,userId,theme,onThemeChange,stravaConnected,onStravaChange}) {
  const [open,setOpen]=useState(false);
  const [ouraKey,setOuraKey]=useState("");
  const [ouraConnected,setOuraConnected]=useState(false);
  const [garminConnected,setGarminConnected]=useState(false);
  const [garminEmail,setGarminEmail]=useState("");
  const [garminPassword,setGarminPassword]=useState("");
  const [garminError,setGarminError]=useState("");
  const [garminLoading,setGarminLoading]=useState(false);
  const setStravaConnected = onStravaChange;
  const [appleHealthHasData,setAppleHealthHasData]=useState(false);
  const [claudeConnected,setClaudeConnected]=useState(false);
  const [syncing,setSyncing]=useState(null); // null | 'oura' | 'strava' | 'apple'
  const [resyncing, setResyncing]=useState(false); // local state for Score History resync
  const [urlCopied,setUrlCopied]=useState(false);
  const [planInfo,setPlanInfo]=useState(null); // null | { isPremium, insightCount }

  const ref=useRef(null);
  const user=session?.user;
  const initials=user?.user_metadata?.name?.split(" ").map(w=>w[0]).join("").slice(0,2).toUpperCase()||user?.email?.[0]?.toUpperCase()||"?";
  const avatar=user?.user_metadata?.avatar_url;
  const [isIOS, setIsIOS] = useState(false);
  useEffect(()=>{ setIsIOS(!!window.daylabNative); },[]);

  useEffect(()=>{
    if(!token||!open)return;
    dbLoad("global","settings",token).then(d=>{
      if(d?.ouraToken){setOuraKey(d.ouraToken);setOuraConnected(true);}
      if(d?.garminTokens?.oauth1){setGarminConnected(true);}
    }).catch(()=>{});
    // Fetch plan status
    const _sbPlan = createClient();
    Promise.all([
      _sbPlan.from('entries').select('data').eq('type','premium').eq('date','global').eq('user_id',userId).maybeSingle(),
      _sbPlan.from('entries').select('data').eq('type','insight_usage').eq('date','global').eq('user_id',userId).maybeSingle(),
    ]).then(([premRow, usageRow]) => {
      setPlanInfo({
        isPremium: premRow.data?.data?.active === true,
        insightCount: usageRow.data?.data?.count || 0,
        plan: premRow.data?.data?.plan || null,
      });
    }).catch(()=>{});
    fetch("/api/entries?date=0000-00-00&type=strava_token",{headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{if(d?.data?.access_token)setStravaConnected(true);}).catch(()=>{});
    // Check Apple Health data + Claude MCP connection (use singleton — no new GoTrueClient)
    const _sb = createClient();
    _sb.from("entries").select("data").eq("type","health_apple").limit(5)
      .then(({data})=>{
        const hasReal = data?.some(r => r.data && Object.keys(r.data).some(k=>r.data[k]));
        if(hasReal) setAppleHealthHasData(true);
      }).catch(()=>{});
    Promise.all([
      _sb.from("entries").select("date").eq("type","oauth_token").limit(1),
      _sb.from("entries").select("date").eq("type","agent_token").eq("date","global").limit(1),
    ]).then(([oauth, agent])=>{
      if(oauth.data?.length || agent.data?.length) setClaudeConnected(true);
    }).catch(()=>{});
  },[token,open]); // eslint-disable-line
  useEffect(()=>{
    if(!open)return;
    const fn=e=>{if(ref.current&&!ref.current.contains(e.target))setOpen(false);};
    document.addEventListener("mousedown",fn);
    return ()=>document.removeEventListener("mousedown",fn);
  },[open]);

  const row={padding:"0 16px"};
  const divider=<div style={{height:1,background:C.border,margin:"10px 0"}}/>;
  const FREE_LIMIT = 10;
  const planBadge = planInfo === null ? null : planInfo.isPremium ? (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:`1px solid ${C.accent}30`,overflow:"hidden"}}>
      <div style={{padding:"10px 12px",textAlign:"center"}}>
        <div style={{fontFamily:mono,fontSize:F.sm,color:C.accent,letterSpacing:"0.06em",textTransform:"uppercase"}}>Premium ✦</div>
        <div style={{fontFamily:mono,fontSize:"10px",color:C.muted,marginTop:3}}>{planInfo.plan === 'yearly' ? 'Annual plan · $4/mo' : 'Monthly plan · $5/mo'}</div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"7px 12px",background:"none",borderTop:`1px solid ${C.accent}20`,border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",textAlign:"center"}}>
        Manage Plan →
      </button>
    </div>
  ) : (
    <div style={{margin:"0 12px 10px",borderRadius:6,border:`1px solid ${C.border}`,overflow:"hidden"}}>
      <div style={{padding:"8px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.06em",textTransform:"uppercase"}}>Free plan</div>
          <div style={{fontFamily:mono,fontSize:"10px",color:C.dim,marginTop:2}}>{planInfo.insightCount}/{FREE_LIMIT} AI insights used</div>
        </div>
        <div style={{width:32,height:32,position:"relative"}}>
          <svg viewBox="0 0 32 32" style={{width:32,height:32,transform:"rotate(-90deg)"}}>
            <circle cx="16" cy="16" r="12" fill="none" stroke={C.border} strokeWidth="3"/>
            <circle cx="16" cy="16" r="12" fill="none" stroke={C.accent} strokeWidth="3"
              strokeDasharray={`${Math.min(planInfo.insightCount/FREE_LIMIT,1)*75.4} 75.4`}
              strokeLinecap="round"/>
          </svg>
        </div>
      </div>
      <button onClick={()=>window.location.href="/upgrade"} style={{width:"100%",padding:"8px 12px",background:C.accent,border:"none",cursor:"pointer",fontFamily:mono,fontSize:"10px",color:C.bg,letterSpacing:"0.1em",textTransform:"uppercase",textAlign:"center"}}>
        Upgrade to Premium →
      </button>
    </div>
  );
  const connBtn = (color=C.green) => ({width:"100%",padding:"7px",textAlign:"center",boxSizing:"border-box",background:"none",border:`1px solid ${color}`,borderRadius:5,color:color,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",cursor:"pointer"});
  // Use the module-level singleton — avoids spawning new GoTrueClient instances

  async function connectOura() {
    if(!ouraKey.trim()) return;
    setSyncing("oura");
    try {
      // Save token
      await fetch("/api/entries",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({date:"global",type:"settings",data:{ouraToken:ouraKey.trim()}})});
      setOuraConnected(true);
      // Backfill history
      const res = await fetch("/api/oura-backfill",{method:"POST",
        headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({})});
      const d = await res.json();
      if(!d.ok) console.warn("Oura backfill error:", d.error);
      // Also recompute all scores from the fresh data
      fetch('/api/scores-backfill', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      }).catch(() => {});
    } catch(e) { console.warn("Oura connect failed:", e); }
    setSyncing(null);
  }

  async function disconnectOura() {
    // disconnect immediately — no prompt (confirm() is blocked in WKWebView)
    const sb = createClient();
    const {data:s} = await sb.from("entries").select("data").eq("type","settings").eq("date","global").eq("user_id",userId).maybeSingle();
    const updated = {...(s?.data||{})}; delete updated.ouraToken;
    await sb.from("entries").upsert({user_id:userId,date:"global",type:"settings",data:updated,updated_at:new Date().toISOString()},{onConflict:"user_id,date,type"});
    setOuraConnected(false); setOuraKey("");
  }

  async function connectAppleHealth() {
    const tok = token||localStorage.getItem("daylab:token")||"";
    if(window.webkit?.messageHandlers?.daylabRequestHealthKit) {
      window.webkit.messageHandlers.daylabRequestHealthKit.postMessage({token:tok});
      // After HealthKit permission, poll for real data appearing
      setSyncing("apple");
      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        const sb = createClient();
        const {data} = await sb.from("entries").select("data").eq("type","health_apple").limit(5);
        const hasReal = data?.some(r=>r.data&&Object.keys(r.data).some(k=>r.data[k]));
        if(hasReal || attempts > 20) {
          clearInterval(poll);
          if(hasReal) setAppleHealthHasData(true);
          setSyncing(null);
        }
      }, 3000);
    }
  }

  async function disconnectAppleHealth() {
    // disconnect immediately
    const sb = createClient();
    await sb.from("entries").delete().eq("type","health_apple").eq("user_id",userId);
    setAppleHealthHasData(false);
  }

  async function connectStrava() {
    window.location.href="/api/strava-connect";
  }

  async function connectGarmin() {
    if (!garminEmail.trim() || !garminPassword.trim()) return;
    setGarminLoading(true); setGarminError("");
    try {
      const r = await fetch("/api/garmin-auth", {
        method:"POST",
        headers:{"Content-Type":"application/json",Authorization:`Bearer ${token}`},
        body:JSON.stringify({email:garminEmail.trim(),password:garminPassword}),
      });
      const d = await r.json();
      if (!r.ok || d.error) {
        setGarminError(d.error === "invalid_credentials" ? "Wrong email or password" : "Connection failed. Try again.");
      } else {
        setGarminConnected(true); setGarminEmail(""); setGarminPassword("");
      }
    } catch { setGarminError("Connection failed. Try again."); }
    setGarminLoading(false);
  }

  async function disconnectGarmin() {
    await fetch("/api/garmin-auth", {method:"DELETE",headers:{Authorization:`Bearer ${token}`}});
    setGarminConnected(false); setGarminEmail(""); setGarminPassword(""); setGarminError("");
  }

  async function disconnectStrava() {
    // disconnect immediately
    const sb = createClient();
    await sb.from("entries").delete().eq("type","strava_token").eq("user_id",userId);
    setStravaConnected(false);
  }

  return (
    <div ref={ref} style={{position:"relative"}}>
      <button onClick={()=>setOpen(o=>!o)} style={{
        width:32,height:32,borderRadius:"50%",padding:0,cursor:"pointer",
        border:`1.5px solid ${C.border2}`,background:avatar?"transparent":C.surface,
        overflow:"hidden",display:"flex",alignItems:"center",justifyContent:"center"}}>
        {avatar?<img src={avatar} width={32} height={32} style={{objectFit:"cover"}} alt=""/>
          :<span style={{fontFamily:mono,fontSize:F.sm,color:C.muted}}>{initials}</span>}
      </button>

      {open&&(
        <div style={{
          position:"absolute",top:40,right:0,width:272,zIndex:300,
          background:C.card,border:`1px solid ${C.border2}`,borderRadius:R,
          padding:"14px 0",display:"flex",flexDirection:"column",
          boxShadow:C.shadow,overflowY:"auto",maxHeight:"85vh",
        }}>

          {/* Identity + refresh */}
          <div style={{...row,paddingBottom:2,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontFamily:blurweb,fontSize:F.md,color:theme==="light"?"#6B5440":"#EFDFC3",letterSpacing:"0.04em"}}>{user?.user_metadata?.name||"—"}</div>
              <div style={{fontFamily:mono,fontSize:F.sm,color:C.dim,marginTop:2}}>{user?.email}</div>
            </div>
            <button
              onClick={()=>window.location.reload()}
              title="Refresh"
              style={{background:"none",border:"none",cursor:"pointer",padding:6,borderRadius:6,
                display:"flex",alignItems:"center",justifyContent:"center",
                flexShrink:0,opacity:0.4,transition:"opacity 0.15s, background 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.background=C.border2;}}
              onMouseLeave={e=>{e.currentTarget.style.opacity="0.4";e.currentTarget.style.background="none";}}
            >
              <svg width="18" height="18" viewBox="0 0 1500 1500" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M841 518C841 551 842.5 578 845.5 599C849.5 619 856.5 635 866.5 647C877.5 659 892.5 667 911.5 671C930.5 675 955 677 985 677C1015 677 1039 679.5 1057 684.5C1076 689.5 1090.5 696 1100.5 704C1110.5 712 1117 721.5 1120 732.5C1124 742.5 1126 753 1126 764C1126 775 1124.5 786.5 1121.5 798.5C1119.5 809.5 1114 819.5 1105 828.5C1096 837.5 1082.5 845 1064.5 851C1046.5 857 1022 860 991 860C961 860 936 862 916 866C897 870 882 877.5 871 888.5C860 898.5 852 913 847 932C843 950 841 973 841 1001C841 1035 838.5 1061.5 833.5 1080.5C828.5 1099.5 821.5 1113.5 812.5 1122.5C804.5 1131.5 795 1137 784 1139C773 1141 762 1142 751 1142C721 1142 698.5 1133.5 683.5 1116.5C668.5 1098.5 661 1061 661 1004C661 951 651.5 914 632.5 893C614.5 871 580 860 529 860C481 860 443 854.5 415 843.5C387 831.5 373 806 373 767C373 737 383.5 714.5 404.5 699.5C426.5 684.5 466 677 523 677C551 677 574 675 592 671C610 666 624 658 634 647C645 635 652 619 655 599C659 579 661 553 661 521C661 493 663.5 470.5 668.5 453.5C673.5 436.5 680 423.5 688 414.5C696 405.5 705.5 399.5 716.5 396.5C727.5 393.5 739 392 751 392C784 392 807 403.5 820 426.5C834 448.5 841 479 841 518Z" fill={theme==="light"?"#6B5440":"#EFDFC3"}/>
                <path d="M1138 476C1138 488.667 1135.33 500.667 1130 512C1125.33 522.667 1118.67 532.333 1110 541C1102 549 1092.33 555.667 1081 561C1070.33 565.667 1059.33 568 1048 568C1036.67 568 1025.33 565.667 1014 561C1003.33 555.667 993.667 549 985 541C976.333 532.333 969.333 522.667 964 512C958.667 500.667 956 488.667 956 476C956 463.333 958.333 451.333 963 440C968.333 428.667 975 418.667 983 410C991.667 401.333 1001.33 394.667 1012 390C1023.33 384.667 1035.33 382 1048 382C1060.67 382 1072.33 384.667 1083 390C1094.33 394.667 1104 401.333 1112 410C1120 418.667 1126.33 428.667 1131 440C1135.67 451.333 1138 463.333 1138 476ZM1013 474C1013 484 1016.33 492.333 1023 499C1029.67 505.667 1038 509 1048 509C1058 509 1066.33 505.667 1073 499C1079.67 492.333 1083 484 1083 474C1083 464 1079.67 455.667 1073 449C1066.33 442.333 1058 439 1048 439C1038 439 1029.67 442.333 1023 449C1016.33 455.667 1013 464 1013 474Z" fill={theme==="light"?"#6B5440":"#EFDFC3"}/>
              </svg>
            </button>
          </div>
          {divider}
          {planBadge}

          {divider}

          {/* Apple Health */}
          <div style={row}>
            <IntegrationRow
              label="Apple Health"
              subtitle={!isIOS && !appleHealthHasData ? "iOS App Required" : syncing==="apple" ? "Syncing…" : null}
              connected={appleHealthHasData}
              onToggleOn={isIOS ? connectAppleHealth : ()=>{}}
              onToggleOff={disconnectAppleHealth}
            />
          </div>

          {divider}

          {/* Oura */}
          <div style={row}>
            <IntegrationRow
              label="Oura"
              subtitle={syncing==="oura" ? "Syncing history…" : null}
              connected={ouraConnected}
              onToggleOn={ouraKey.trim() ? connectOura : ()=>window.open("https://cloud.ouraring.com/personal-access-tokens","_blank")}
              onToggleOff={disconnectOura}
              pendingToggle={!ouraConnected && !!ouraKey.trim()}
            >
              {!ouraConnected && (
                <form onSubmit={e=>{e.preventDefault();connectOura();}} style={{flex:1,minWidth:0,display:"flex"}}>
                  <input type="password" value={ouraKey}
                    onChange={e=>setOuraKey(e.target.value)}
                    placeholder="Token"
                    className="oura-token-input"
                    autoComplete="current-password"
                    style={{flex:1,minWidth:0,background:C.surface,border:`1px solid ${C.border2}`,
                      borderRadius:5,outline:"none",color:C.text,fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",boxSizing:"border-box",width:0}}/>
                </form>
              )}
            </IntegrationRow>
          </div>

          {divider}

          {/* Garmin */}
          <div style={row}>
            <IntegrationRow
              label="Garmin"
              connected={garminConnected}
              onToggleOn={garminEmail.trim() && garminPassword.trim() && !garminLoading ? connectGarmin : ()=>{}}
              onToggleOff={disconnectGarmin}
              pendingToggle={!garminConnected && !!garminEmail.trim() && !!garminPassword.trim()}
            >
              {!garminConnected && (
                <form onSubmit={e=>{e.preventDefault();connectGarmin();}} style={{display:"flex",flexDirection:"column",gap:4,flex:1,minWidth:0}}>
                  <input type="email" value={garminEmail}
                    onChange={e=>setGarminEmail(e.target.value)}
                    placeholder="Garmin email"
                    autoComplete="username"
                    style={{background:C.surface,border:`1px solid ${C.border2}`,
                      borderRadius:5,outline:"none",color:C.text,fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",width:"100%",boxSizing:"border-box"}}/>
                  <input type="password" value={garminPassword}
                    onChange={e=>setGarminPassword(e.target.value)}
                    placeholder="Garmin password"
                    autoComplete="current-password"
                    style={{background:C.surface,border:`1px solid ${C.border2}`,
                      borderRadius:5,outline:"none",color:C.text,fontFamily:mono,fontSize:F.sm,
                      padding:"5px 7px",width:"100%",boxSizing:"border-box"}}/>
                  {garminLoading && <span style={{fontFamily:mono,fontSize:F.sm,color:C.dim}}>Connecting…</span>}
                  {garminError && <span style={{fontFamily:mono,fontSize:F.sm,color:C.red}}>{garminError}</span>}
                </form>
              )}
            </IntegrationRow>
          </div>

          {divider}

          {/* Strava */}
          <div style={row}>
            <IntegrationRow
              label="Strava"
              subtitle={syncing==="strava" ? "Syncing history…" : null}
              connected={stravaConnected}
              onToggleOn={connectStrava}
              onToggleOff={disconnectStrava}
            />
          </div>

          {divider}

          {/* Claude */}          <div style={row}>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted}}>
                Claude MCP
              </span>
              {!claudeConnected && (
                <a href="https://claude.ai/settings/connectors?modal=add-custom-connector"
                  target="_blank" rel="noreferrer"
                  style={{fontFamily:mono,fontSize:F.sm,color:C.dim,textDecoration:"none",letterSpacing:"0.02em"}}>
                  add →
                </a>
              )}
              {claudeConnected && (
                <span style={{fontFamily:mono,fontSize:F.sm,color:C.green}}>✓</span>
              )}
            </div>
            <div style={{
              display:"flex",alignItems:"center",gap:6,
              background:C.surface,border:`1px solid ${C.border2}`,
              borderRadius:5,padding:"6px 8px",
            }}>
              <span style={{flex:1,fontFamily:mono,fontSize:F.sm,
                userSelect:"all",letterSpacing:"0.02em",overflow:"hidden",
                textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.muted}}>
                {window.location.origin}/mcp
              </span>
              <button
                onClick={()=>{
                  navigator.clipboard.writeText(window.location.origin + "/mcp");
                  setUrlCopied(true);setTimeout(()=>setUrlCopied(false),2000);
                }}
                title="Copy URL"
                style={{background:"none",border:"none",cursor:"pointer",
                  color:urlCopied?C.green:C.dim,padding:0,flexShrink:0,
                  display:"flex",alignItems:"center",lineHeight:1}}>
                {urlCopied
                  ? <span style={{fontSize:11}}>✓</span>
                  : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                }
              </button>
            </div>
          </div>

          {divider}

          {/* Theme */}
          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',color:C.muted}}>
              {theme==="dark"?"Dark":"Light"} Mode
            </span>
            <button onClick={()=>onThemeChange(t=>t==="dark"?"light":"dark")}
              style={{
                background:theme==="dark"?"rgba(196,168,130,0.15)":"rgba(155,107,58,0.12)",
                border:`1px solid ${C.border2}`,borderRadius:20,cursor:"pointer",
                padding:3,display:"flex",alignItems:"center",width:40,height:22,
                justifyContent:theme==="dark"?"flex-end":"flex-start"}}>
              <div style={{width:14,height:14,borderRadius:"50%",background:C.accent,transition:"all 0.2s"}}/>
            </button>
          </div>

          {divider}

          {/* Downloads — label + small buttons inline */}
          <div style={{...row,display:"flex",alignItems:"center",gap:8}}>
            <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,flex:1}}>
              Downloads
            </span>
            <a href="https://github.com/malvidah/lifeos/releases/download/v1.0.2/Day.Lab-1.0.2-arm64.dmg" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:C.surface,
              border:`1px solid ${C.border2}`,borderRadius:5,textDecoration:"none",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Mac
            </a>
            <a href="/download/ios" style={{
              display:"flex",alignItems:"center",gap:4,
              padding:"4px 9px",background:C.surface,
              border:`1px solid ${C.border2}`,borderRadius:5,textDecoration:"none",
              color:C.muted,fontFamily:mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",flexShrink:0}}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12" y2="18"/>
              </svg>
              iOS
            </a>
          </div>

          {divider}

          <div style={{...row,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <a href="/about"
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:C.dim,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",
                textTransform:"uppercase",textDecoration:"none"}}>
              Learn More
            </a>
            <button onClick={async()=>{const s=createClient();await s.auth.signOut();}}
              style={{background:"none",border:"none",padding:0,cursor:"pointer",
                color:C.dim,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase"}}>
              Sign Out →
            </button>
          </div>

        </div>
      )}
    </div>
  );
}

// ─── TopBar ───────────────────────────────────────────────────────────────────
function TopBar({session,token,userId,syncStatus,theme,onThemeChange,selected,onGoToToday,stravaConnected,onStravaChange}) {
  // Format selected date as "Mon, Mar 1" — the actual context anchor
  const [dateLabel, setDateLabel] = useState("");
  const [isToday, setIsToday] = useState(false);
  useEffect(() => {
    if (!selected) return;
    const selDate = new Date(selected + "T12:00:00");
    const today = toKey(new Date());
    setIsToday(selected === today);
    setDateLabel(selDate.toLocaleDateString("en-US", {
      weekday: "long", month: "long", day: "numeric"
    }));
  }, [selected]);
  const isElectron = typeof window !== "undefined" && (!!window.daylabNative || !!window.dayloopNative);
  return (
    <div style={{
      paddingTop: "calc(env(safe-area-inset-top, 0px) + 28px)",
      paddingLeft: 18, paddingRight: 14,
      paddingBottom: 10,
      flexShrink: 0,
      position: "sticky", top: 0, zIndex: 100,
      WebkitAppRegion: "drag", userSelect: "none",
    }}>
      {/* Pull-down overscroll patch */}
      <div style={{position:"fixed",top:"-100px",left:0,right:0,height:"100px",background:C.bg,zIndex:99}}/>
      {/* DAY LAB wordmark — full-width centered */}
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        display: "flex", alignItems: "center", justifyContent: "center",
        paddingBottom: 6,
        WebkitAppRegion: "drag",
      }}>
        <span style={{
          fontFamily: blurweb,
          fontSize: 22,
          letterSpacing: "normal",
          textTransform: "uppercase",
          color: theme === "light" ? "#6B5440" : "#EFDFC3",
          userSelect: "none",
          lineHeight: 1,
          pointerEvents: "none",
        }}>DAY LAB</span>
      </div>

      {/* User menu — overlaid far right, same vertical band */}
      <div style={{
        maxWidth: 1200, margin: "0 auto",
        height: 0,
        display: "flex", alignItems: "flex-start", justifyContent: "flex-end",
        transform: "translateY(-36px)",
        WebkitAppRegion: "drag",
      }}>
        <div style={{WebkitAppRegion:"no-drag", position:"relative", zIndex:101}}>
          <UserMenu session={session} token={token} userId={userId} theme={theme} onThemeChange={onThemeChange} stravaConnected={stravaConnected} onStravaChange={onStravaChange}/>
        </div>
      </div>
    </div>
  );
}

// ─── MonthView ────────────────────────────────────────────────────────────────
// Only truly special events belong on the month grid — not meals or daily tasks
const BIG_EVENT_KEYWORDS = /birthday|bday|anniversary|wedding|graduation|party|trip|camping|hike|concert|festival|game.?night|board.?game|vacation|holiday|travel|flight|conference|retreat|summit|christm|thanksgiv|new.?year|halloween|passover|hanukkah|diwali|eid|week.?off|day.?off|surgery|date.?night|show|performance|recital|marathon|race|gala|ceremony|opening.?night|potluck|picnic|reunion|sleepover|road.?trip/i;

function isBigEvent(ev) {
  if (!ev) return false;
  if (ev.allDay || ev.time === 'all day') return true;
  return BIG_EVENT_KEYWORDS.test(ev.title || '');
}

function MonthView({ initYear, initMonth, selected, onSelectDay, onMonthChange, healthDots, events, token }) {
  const [summaries,    setSummaries]    = useState({});
  const [summaryCache, setSummaryCache] = useState({});

  // ── Physics ────────────────────────────────────────────────────────────
  // liveOff = fractional month index (year*12 + month)
  const liveOff    = useRef(initYear * 12 + initMonth);
  const vel        = useRef(0);
  const rafId      = useRef(null);
  const dragBase   = useRef(0);
  const startY     = useRef(0);
  const lastY      = useRef(0);
  const touchVel   = useRef(0);
  const totalDrag  = useRef(0);
  const isDragging = useRef(false);
  const containerRef = useRef(null);
  const [displayOff, setDisplayOff] = useState(initYear * 12 + initMonth);

  // Responsive sizing — derive CELL_H from available height so months pack tight
  // SSR-safe: start at 1200 to avoid hydration mismatch; real value set after mount
  const [vw, setVw] = useState(1200);
  useEffect(()=>{
    setVw(window.innerWidth); // sync on first client render
    const onResize = () => setVw(window.innerWidth);
    window.addEventListener('resize', onResize);
    return ()=>window.removeEventListener('resize', onResize);
  },[]);
  const DAY_HDR_H_C = 20;
  const LABEL_H   = 18;
  const MONTH_H   = vw < 600 ? 340 : 400;
  const SCROLL_H_C = MONTH_H - DAY_HDR_H_C;
  const CELL_H    = Math.floor((SCROLL_H_C - LABEL_H - 5 * 2) / 6); // 5 gaps of 2px between 6 rows

  // Use refs for callbacks so mount-only listeners always see fresh values
  const repaint    = useRef(null);
  const cancelRaf  = useRef(null);
  const snapTo     = useRef(null);
  const doMomentum = useRef(null);
  const animateTo  = useRef(null);

  repaint.current = () => setDisplayOff(liveOff.current);

  cancelRaf.current = () => {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  };

  snapTo.current = (target) => {
    cancelRaf.current();
    liveOff.current = target;
    vel.current = 0;
    repaint.current();
    const yr = Math.floor(target / 12);
    const mo = ((target % 12) + 12) % 12;
    onMonthChange(yr, mo);
  };

  doMomentum.current = () => {
    cancelRaf.current();
    const step = () => {
      vel.current *= 0.88;          // gentle friction — long, smooth coast
      liveOff.current += vel.current;
      const target = Math.round(liveOff.current * 4) / 4; // snap to nearest week (~0.25 month)
      liveOff.current += (target - liveOff.current) * 0.08; // soft spring
      if (Math.abs(vel.current) < 0.0008 && Math.abs(liveOff.current - target) < 0.0008) {
        snapTo.current(target); return;
      }
      repaint.current();
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  };

  animateTo.current = (target) => {
    cancelRaf.current();
    const step = () => {
      const diff = target - liveOff.current;
      if (Math.abs(diff) < 0.001) { snapTo.current(target); return; }
      liveOff.current += diff * 0.12; // softer spring — feels like settling
      repaint.current();
      rafId.current = requestAnimationFrame(step);
    };
    rafId.current = requestAnimationFrame(step);
  };

  useEffect(() => () => cancelRaf.current(), []);

  // Sync when parent changes month (e.g. selecting a date)
  useEffect(() => {
    const target = initYear * 12 + initMonth;
    if (Math.abs(liveOff.current - target) > 0.5) animateTo.current(target);
  }, [initYear, initMonth]); // eslint-disable-line

  // ── Mount-only global listeners (refs keep them fresh) ─────────────────
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!isDragging.current) return;
      const dy = e.clientY - startY.current;
      totalDrag.current = Math.abs(dy);
      // drag DOWN = past (lower liveOff), drag UP = future (higher liveOff)
      liveOff.current = dragBase.current - dy / MONTH_H;
      touchVel.current = -(e.clientY - lastY.current) / MONTH_H;
      lastY.current = e.clientY;
      repaint.current();
    };
    const onMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      vel.current = touchVel.current * 2.0;
      if (Math.abs(vel.current) > 0.008) doMomentum.current();
      else snapTo.current(Math.round(liveOff.current * 4) / 4);
    };
    let wheelTimer = null;
    const onWheel = (e) => {
      if (!containerRef.current?.contains(e.target)) return;
      e.preventDefault();
      cancelRaf.current();
      isDragging.current = false;
      // scroll DOWN = future (deltaY positive → increase liveOff)
      const delta = e.deltaY / (Math.abs(e.deltaY) > 50 ? 600 : 130);
      liveOff.current += delta;
      repaint.current();
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => snapTo.current(Math.round(liveOff.current * 4) / 4), 200);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',   onMouseUp);
    window.addEventListener('wheel',     onWheel, { passive: false });
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup',   onMouseUp);
      window.removeEventListener('wheel',     onWheel);
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }, []); // mount only

  // Touch handlers via JSX
  const handleTouchStart = (e) => {
    cancelRaf.current();
    isDragging.current = true;
    totalDrag.current  = 0;
    startY.current     = e.touches[0].clientY;
    lastY.current      = e.touches[0].clientY;
    dragBase.current   = liveOff.current;
    touchVel.current   = 0;
  };
  const handleTouchMove = (e) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const y  = e.touches[0].clientY;
    const dy = y - startY.current;
    totalDrag.current  = Math.abs(dy);
    liveOff.current    = dragBase.current - dy / MONTH_H; // up=future, down=past
    touchVel.current   = -(y - lastY.current) / MONTH_H;
    lastY.current      = y;
    repaint.current();
  };
  const handleTouchEnd = () => {
    if (!isDragging.current) return;
    isDragging.current = false;
    vel.current = touchVel.current * 2.0;
    if (Math.abs(vel.current) > 0.008) doMomentum.current();
    else snapTo.current(Math.round(liveOff.current * 4) / 4);
  };
  const handleMouseDown = (e) => {
    e.preventDefault();
    cancelRaf.current();
    isDragging.current = true;
    totalDrag.current  = 0;
    startY.current     = e.clientY;
    lastY.current      = e.clientY;
    dragBase.current   = liveOff.current;
    touchVel.current   = 0;
  };

  // ── Load AI summaries ──────────────────────────────────────────────────
  const snappedIdx = Math.round(displayOff);

  useEffect(() => {
    if (!token) return;
    [-1, 0, 1].forEach(offset => {
      const idx = snappedIdx + offset;
      const yr  = Math.floor(idx / 12);
      const mo  = ((idx % 12) + 12) % 12;
      const key = `${yr}-${mo}`;
      if (summaryCache[key] !== undefined) return;
      setSummaryCache(prev => ({ ...prev, [key]: null }));
      fetch('/api/month-summaries', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ year: yr, month: mo }),
      }).then(r => r.json()).then(d => {
        if (d.summaries) setSummaries(prev => ({ ...prev, ...d.summaries }));
        setSummaryCache(prev => ({ ...prev, [key]: true }));
      }).catch(() => {});
    });
  }, [snappedIdx, token]); // eslint-disable-line

  // ── Helpers ────────────────────────────────────────────────────────────
  const today = todayKey();
  const DAY_NAMES   = ['S','M','T','W','R','F','S']; // R=Thu to distinguish from T=Tue
  const MONTH_NAMES = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
  const fracOff = displayOff - snappedIdx;
  const N = 2;

  // Build a 42-cell (6-row) continuous grid for a given year/month.
  // Cells before day 1 come from the previous month; cells after the last day
  // come from the next month. Each cell: { day, dateKey, isOverflow }.
  function buildGrid(yr, mo) {
    const firstDow   = new Date(yr, mo, 1).getDay();
    const daysInMonth = new Date(yr, mo + 1, 0).getDate();

    // prev month overflow
    const prevDate   = new Date(yr, mo, 0); // last day of prev month
    const prevDays   = prevDate.getDate();
    const prevMo     = prevDate.getMonth();
    const prevYr     = prevDate.getFullYear();

    // next month
    const nextDate   = new Date(yr, mo + 1, 1);
    const nextMo     = nextDate.getMonth();
    const nextYr     = nextDate.getFullYear();

    const cells = [];
    // leading overflow from previous month
    for (let i = firstDow - 1; i >= 0; i--) {
      const d   = prevDays - i;
      const key = `${prevYr}-${String(prevMo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, dateKey: key, isOverflow: true });
    }
    // current month days
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${yr}-${String(mo+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      cells.push({ day: d, dateKey: key, isOverflow: false });
    }
    // trailing overflow to next month — fill to 42 cells (6 rows)
    let nextDay = 1;
    while (cells.length < 42) {
      const key = `${nextYr}-${String(nextMo+1).padStart(2,'0')}-${String(nextDay).padStart(2,'0')}`;
      cells.push({ day: nextDay, dateKey: key, isOverflow: true });
      nextDay++;
    }
    return cells;
  }

  // ── Year scrubber state ───────────────────────────────────────────────
  const SCRUB_MIN_YR = 2020;
  const SCRUB_MAX_YR = 2030;
  const SCRUB_RANGE  = SCRUB_MAX_YR - SCRUB_MIN_YR; // 10 years
  const [scrubHover, setScrubHover] = useState(false);
  const [scrubDragging, setScrubDragging] = useState(false);
  const scrubRef = useRef(null);

  const currentYr = Math.floor(snappedIdx / 12);
  const currentMo = ((snappedIdx % 12) + 12) % 12;
  const thumbPct  = Math.max(0, Math.min(1, (currentYr - SCRUB_MIN_YR) / SCRUB_RANGE));

  const scrubJumpToY = (clientY) => {
    if (!scrubRef.current) return;
    const rect = scrubRef.current.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    const yr   = Math.round(SCRUB_MIN_YR + pct * SCRUB_RANGE);
    animateTo.current(yr * 12 + currentMo);
  };

  useEffect(() => {
    if (!scrubDragging) return;
    const onMove = (e) => scrubJumpToY(e.touches ? e.touches[0].clientY : e.clientY);
    const onUp   = () => setScrubDragging(false);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend',  onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
  }, [scrubDragging]); // eslint-disable-line

  const SCRUB_W    = vw < 600 ? 12 : 18; // narrower on mobile
  const DAY_HDR_H  = DAY_HDR_H_C;
  const SCROLL_H   = SCROLL_H_C;

  return (
    <div style={{ userSelect: 'none', touchAction: 'none' }}>

      {/* ── Fixed top row: scrubber gap + S M T W R F S ── */}
      <div style={{ display: 'flex', alignItems: 'center', height: DAY_HDR_H }}>
        {/* spacer matching scrubber width */}
        <div style={{ width: SCRUB_W, flexShrink: 0 }} />
        {/* day-of-week labels — never scroll */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)',
                      paddingRight: 4 }}>
          {DAY_NAMES.map((n, i) => (
            <div key={i} style={{
              textAlign: 'center', fontFamily: mono, fontSize: '10px',
              fontWeight: '500', letterSpacing: '0.08em', color: C.muted,
            }}>{n}</div>
          ))}
        </div>
      </div>

      {/* ── Scrollable area: scrubber + calendar pane side by side ── */}
      <div style={{ display: 'flex', height: SCROLL_H, overflow: 'hidden', position: 'relative' }}>

        {/* Year scrubber */}
        <div
          ref={scrubRef}
          onMouseEnter={() => setScrubHover(true)}
          onMouseLeave={() => setScrubHover(false)}
          onMouseDown={e => { e.stopPropagation(); setScrubDragging(true); scrubJumpToY(e.clientY); }}
          onTouchStart={e => { e.stopPropagation(); setScrubDragging(true); scrubJumpToY(e.touches[0].clientY); }}
          style={{
            width: SCRUB_W, flexShrink: 0, position: 'relative',
            cursor: 'ns-resize', display: 'flex', justifyContent: 'center',
            paddingTop: 4, paddingBottom: 4, boxSizing: 'border-box',
          }}
        >
          <div style={{
            width: 1, height: '100%',
            background: scrubHover || scrubDragging ? C.border2 : C.border,
            borderRadius: 1, transition: 'background 0.2s', position: 'relative',
          }}>
            <div style={{
              position: 'absolute', left: '50%', transform: 'translate(-50%, -50%)',
              top: `${thumbPct * 100}%`,
              width: scrubHover || scrubDragging ? 5 : 3,
              height: scrubHover || scrubDragging ? 20 : 14,
              borderRadius: 3,
              background: scrubHover || scrubDragging ? C.accent : C.muted,
              transition: 'width 0.15s, height 0.15s, background 0.15s',
            }} />
          </div>
          {(scrubHover || scrubDragging) && (
            <div style={{
              position: 'absolute', left: 20, top: `calc(${thumbPct * 100}% - 8px)`,
              fontFamily: mono, fontSize: '8px', letterSpacing: '0.08em',
              color: C.accent, whiteSpace: 'nowrap', pointerEvents: 'none',
              background: C.bg, padding: '1px 3px', borderRadius: 2,
            }}>{currentYr}</div>
          )}
        </div>

        {/* Main scrollable calendar pane */}
        <div
          ref={containerRef}
          style={{ flex: 1, overflow: 'hidden', position: 'relative',
                   cursor: isDragging.current ? 'grabbing' : 'grab' }}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {Array.from({ length: N * 2 + 1 }, (_, i) => i - N).map(relOffset => {
            const mIdx = snappedIdx + relOffset;
            const yr   = Math.floor(mIdx / 12);
            const mo   = ((mIdx % 12) + 12) % 12;
            const translateY = (relOffset - fracOff) * SCROLL_H;
            const cells = buildGrid(yr, mo);

            return (
              <div key={mIdx} style={{
                position: 'absolute', top: 0, left: 0, right: 0,
                transform: `translateY(${translateY}px)`,
                willChange: 'transform', height: SCROLL_H,
                padding: '0 4px 4px 4px', boxSizing: 'border-box',
                display: 'flex', flexDirection: 'column',
              }}>
                {/* Month name */}
                <div style={{
                  fontFamily: mono, fontSize: F.sm, fontWeight: 'normal',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  color: C.muted, marginTop: 2, marginBottom: 4, flexShrink: 0,
                  paddingLeft: 2, overflow: 'hidden', whiteSpace: 'nowrap',
                }}>{MONTH_NAMES[mo]}</div>

                {/* 6-row grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridTemplateRows: `repeat(6, ${CELL_H}px)`, gap: 2, flex: 1 }}>
                  {cells.map(({ day, dateKey, isOverflow }, idx) => {
                    // Overflow cells are invisible spacers — no content, no border
                    if (isOverflow) return <div key={`sp-${idx}`} style={{ height: CELL_H }} />;

                    const isToday    = dateKey === today;
                    const isSelected = dateKey === selected;
                    const dots       = dateKey <= today ? (healthDots[dateKey] || {}) : {};
                    const summary    = summaries[dateKey];
                    const bigEvents  = (events[dateKey] || []).filter(isBigEvent).slice(0, 2);
                    const hasDots    = dots.sleep >= 85 || dots.readiness >= 85 ||
                                       dots.activity >= 85 || dots.recovery >= 85;

                    return (
                      <div key={dateKey}
                        onClick={e => { e.stopPropagation(); if (totalDrag.current < 6) onSelectDay(dateKey); }}
                        style={{
                          height: CELL_H, overflow: 'hidden', borderRadius: 5, padding: '4px 4px 3px',
                          cursor: 'pointer', boxSizing: 'border-box',
                          background: isSelected ? C.accent+'1A' : isToday ? C.accent+'0D' : 'transparent',
                          border: `1px solid ${isSelected ? C.accent+'66' : isToday ? C.accent+'33' : C.border+'25'}`,
                          display: 'flex', flexDirection: 'column', gap: 2,
                        }}
                      >
                        {/* Day number */}
                        <div style={{
                          fontFamily: serif, fontSize: '13px', lineHeight: 1,
                          fontWeight: isToday || isSelected ? '700' : 'normal',
                          color: isToday ? C.text : isSelected ? C.accent : C.muted,
                          flexShrink: 0,
                        }}>{day}</div>

                        {/* Health dots */}
                        {hasDots && (
                          <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                            {dots.sleep     >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.blue,    flexShrink: 0 }} />}
                            {dots.readiness >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.green,   flexShrink: 0 }} />}
                            {dots.activity  >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: C.accent,  flexShrink: 0 }} />}
                            {dots.recovery  >= 85 && <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#8B6BB5', flexShrink: 0 }} />}
                          </div>
                        )}

                        {/* Big events:
                             mobile → fixed-height 3px color bars (no text, no height expansion)
                             desktop → text pill as before */}
                        {vw < 600 ? (
                          bigEvents.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0, marginTop: 1 }}>
                              {bigEvents.map((ev, j) => (
                                <div key={j} style={{
                                  height: 3, borderRadius: 2,
                                  background: ev.color || C.accent,
                                  flexShrink: 0,
                                }} title={ev.title} />
                              ))}
                            </div>
                          )
                        ) : (
                          bigEvents.map((ev, j) => (
                            <div key={j} style={{
                              fontFamily: mono, fontSize: '9px', lineHeight: 1.2,
                              color: ev.color || C.accent,
                              background: (ev.color || C.accent) + '28',
                              borderRadius: 3, padding: '2px 3px',
                              overflow: 'hidden', whiteSpace: 'nowrap',
                              textOverflow: 'ellipsis', flexShrink: 0,
                            }}>{ev.title}</div>
                          ))
                        )}

                        {/* AI summary — desktop only, too small to read on mobile */}
                        {vw >= 600 && summary && (
                          <div style={{
                            fontFamily: mono, fontSize: '7.5px', color: C.dim,
                            lineHeight: 1.25, overflow: 'hidden',
                            display: '-webkit-box', WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical', flex: 1, minHeight: 0,
                          }}>{summary}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── CalStrip ─────────────────────────────────────────────────────────────────
// Single epoch: Jan 1 2026. All offsets are integer days from this point.
const MONTHS_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// Convert a YYYY-MM-DD key or Date to an integer day number.
// We avoid epoch subtraction entirely — just count calendar days from a fixed point.
// This sidesteps ALL timezone/DST issues.
function keyToDayNum(key) {
  // key is always "YYYY-MM-DD" local date
  const [y, m, d] = key.split("-").map(Number);
  // Days since a distant fixed point (Jan 1 2000) using pure calendar math
  // Zeller-like: count days in each year/month without Date arithmetic
  function daysFromY2K(yr, mo, dy) {
    let total = 0;
    for (let y = 2000; y < yr; y++) {
      total += (y%4===0&&(y%100!==0||y%400===0)) ? 366 : 365;
    }
    const mdays = [0,31,28,31,30,31,30,31,31,30,31,30,31];
    if (yr%4===0&&(yr%100!==0||yr%400===0)) mdays[2]=29;
    for (let m2 = 1; m2 < mo; m2++) total += mdays[m2];
    return total + dy - 1;
  }
  return daysFromY2K(y, m, d);
}

function dayOffset(dateOrKey) {
  const key = typeof dateOrKey === "string" ? dateOrKey : toKey(dateOrKey);
  return keyToDayNum(key);
}

function offsetToDate(n) {
  // Convert day number back to a local Date at noon
  // We walk from Y2K adding years/months until we land on the right day
  let rem = Math.round(n);
  let yr = 2000;
  while (true) {
    const isLeap = yr%4===0&&(yr%100!==0||yr%400===0);
    const ydays = isLeap ? 366 : 365;
    if (rem < ydays) break;
    rem -= ydays; yr++;
  }
  const mdays = [0,31,28,31,30,31,30,31,31,30,31,30,31];
  if (yr%4===0&&(yr%100!==0||yr%400===0)) mdays[2]=29;
  let mo = 1;
  while (rem >= mdays[mo]) { rem -= mdays[mo]; mo++; }
  // Return as a local noon Date (noon avoids any DST edge)
  return new Date(yr, mo-1, rem+1, 12, 0, 0);
}

// Mobile date picker — horizontal day strip with physics momentum
// Month and year are static labels (snap discretely). Only the day ribbon moves.
function NavBtn({onClick,title,children}) {
  return (
    <button onClick={onClick} title={title} style={{
      background:'none',border:'none',cursor:'pointer',
      color:C.muted,fontFamily:mono,fontSize:F.md,lineHeight:1,
      padding:'3px 5px',borderRadius:4,transition:'color 0.1s',
    }}
    onMouseEnter={e=>e.currentTarget.style.color=C.text}
    onMouseLeave={e=>e.currentTarget.style.color=C.muted}>
      {children}
    </button>
  );
}
function MobileCalPicker({selected, onSelect, events, healthDots={}, desktop=false, onEventClick, onAddClick, collapsed, onToggle, calView='day', onCalViewChange}) {
  const today = todayKey();
  const DAY_W = 175;

  // Single source of truth: fractional day offset from epoch
  const liveOff    = useRef(dayOffset(selected));
  const vel        = useRef(0);          // px/frame rolling average
  const lastX      = useRef(null);
  const lastT      = useRef(null);
  const totalDrag  = useRef(0);          // total px dragged this gesture
  const rafId      = useRef(null);
  const [, bump]   = useState(0);
  const repaint    = () => bump(n => n + 1);

  function cancelRaf() {
    if (rafId.current) { cancelAnimationFrame(rafId.current); rafId.current = null; }
  }

  // Animate liveOff toward a target with spring ease-out
  function animateTo(target) {
    cancelRaf();
    vel.current = 0;
    const startVal = liveOff.current;
    const startTime = performance.now();
    const DURATION = 280;
    const tick = (now) => {
      const t = Math.min((now - startTime) / DURATION, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      liveOff.current = startVal + (target - startVal) * ease;
      repaint();
      if (t < 1) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        liveOff.current = target;
        repaint();
        onSelect(toKey(offsetToDate(target)));
      }
    };
    rafId.current = requestAnimationFrame(tick);
  }

  function snap() { animateTo(Math.round(liveOff.current)); }

  function runMomentum() {
    cancelRaf();
    const FRICTION = 0.86;
    const tick = () => {
      vel.current *= FRICTION;
      liveOff.current -= vel.current / DAY_W;
      repaint();
      if (Math.abs(vel.current) > 1.5) {
        rafId.current = requestAnimationFrame(tick);
      } else {
        animateTo(Math.round(liveOff.current));
      }
    };
    rafId.current = requestAnimationFrame(tick);
  }

  const onTouchStart = e => {
    cancelRaf();
    vel.current = 0;
    totalDrag.current = 0;
    lastX.current = e.touches[0].clientX;
    lastT.current = performance.now();
  };

  const onTouchMove = e => {
    e.preventDefault();
    const x  = e.touches[0].clientX;
    const t  = performance.now();
    const dt = Math.max(t - lastT.current, 4);
    const dx = x - lastX.current;
    totalDrag.current += Math.abs(dx);
    const newVel = (dx / dt) * 16;
    vel.current = vel.current * 0.5 + newVel * 0.5;
    liveOff.current -= dx / DAY_W;
    lastX.current = x;
    lastT.current = t;
    repaint();
  };

  const onTouchEnd = () => {
    if (totalDrag.current > 8 && Math.abs(vel.current) > 1.5) {
      runMomentum();
    } else {
      snap();
    }
  };

  // Sync when parent forces a date (e.g. "today" button)
  useEffect(() => {
    const n = dayOffset(selected);
    if (Math.round(liveOff.current) !== n) {
      cancelRaf();
      liveOff.current = n;
      vel.current = 0;
      repaint();
    }
  }, [selected]); // eslint-disable-line
  useEffect(() => () => cancelRaf(), []); // eslint-disable-line

  // Derived from liveOff
  const off      = liveOff.current;
  const selInt   = Math.round(off);
  const fracSlot = off - selInt;
  const selDate  = offsetToDate(selInt);
  const selMonth = MONTHS_FULL[selDate.getMonth()];
  const selYear  = selDate.getFullYear();

  // Build day items: enough to fill screen
  const N = 6;
  const dayItems = [];
  for (let i = -N; i <= N; i++) {
    dayItems.push({ d: offsetToDate(selInt + i), i });
  }

  const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  function timeToMins(t) {
    if (!t || t === "all day") return -1;
    const m = t.match(/(\d+):(\d+)\s*(AM|PM)?/i);
    if (!m) return 9999;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    const period = (m[3]||"").toUpperCase();
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return h * 60 + min;
  }

  const tapDay = (targetOffset) => {
    if (totalDrag.current > 8) return;
    animateTo(targetOffset);
  };

  const MAX_EVENTS = 5;

  return (
    <div style={{userSelect:"none", display:"flex", flexDirection:"column"}}>

      {/* ── Header bar — collapses/expands calendar ─────────────────────── */}
      <div style={{
        display:"flex", alignItems:"center",
        padding:"10px 16px 8px",
        borderBottom:`1px solid ${C.border}`,
        flexShrink:0, position:'relative',
        cursor: onToggle ? 'pointer' : 'default',
      }} onClick={onToggle}>
        {/* CALENDAR label — left */}
        <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
          {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
          <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted}}>Calendar</span>
        </div>

        {collapsed ? (
          /* ── Collapsed: always day nav — ‹ MAR 10, 2026 › ── */
          (()=>{
            const stepDay = (d,dir) => { const n=new Date(d); n.setDate(n.getDate()+dir); return n; };
            const isToday = toKey(selDate) === today;
            return (
              <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
                display:'flex',alignItems:'center',gap:10,userSelect:'none',whiteSpace:'nowrap'}}>
                <button onClick={e=>{e.stopPropagation();onSelect(toKey(stepDay(selDate,-1)));}} style={{
                  background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'2px 6px',
                  fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.text}
                  onMouseLeave={e=>e.currentTarget.style.color=C.muted}>‹</button>
                <span style={{
                  fontFamily:mono,fontSize:F.sm,letterSpacing:"0.1em",textTransform:"uppercase",
                  color:isToday?C.text:C.accent,
                  background:(isToday?C.text:C.accent)+"1A",
                  borderRadius:6,padding:"4px 10px",
                }}>{selMonth} {selDate.getDate()}, {selYear}</span>
                <button onClick={e=>{e.stopPropagation();onSelect(toKey(stepDay(selDate,+1)));}} style={{
                  background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'2px 6px',
                  fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.text}
                  onMouseLeave={e=>e.currentTarget.style.color=C.muted}>›</button>
              </div>
            );
          })()
        ) : (
          /* ── Expanded: date centered, no arrows ── */
          <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
            pointerEvents:'none',userSelect:'none',whiteSpace:'nowrap'}}>
            <span style={{
              fontFamily:mono,fontSize:F.sm,letterSpacing:"0.1em",textTransform:"uppercase",
              color:toKey(selDate)===today?C.text:C.accent,
              background:(toKey(selDate)===today?C.text:C.accent)+"1A",
              borderRadius:6,padding:"4px 10px",
            }}>
              {selMonth} {selDate.getDate()}, {selYear}
            </span>
          </div>
        )}

        {/* RIGHT: M/D toggle — hidden when collapsed */}
        <div style={{marginLeft:'auto',flexShrink:0,display:'flex',gap:4,alignItems:'center'}} onClick={e=>e.stopPropagation()}>
          {!collapsed && onCalViewChange&&<>
            <button onClick={()=>onCalViewChange('month')}
              style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                padding:'3px 8px',borderRadius:4,cursor:'pointer',
                minHeight:22,minWidth:22,
                background:'none',border:`1px solid ${C.border2}`,color:C.muted}}>M</button>
            <button onClick={()=>onCalViewChange('day')}
              style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                padding:'3px 8px',borderRadius:4,cursor:'pointer',
                minHeight:22,minWidth:22,
                background:C.accent+'22',border:`1px solid ${C.accent}`,color:C.accent}}>D</button>
          </>}
        </div>
      </div>

      {/* ── Day columns with events ──────────────────────────────────────── */}
      {!collapsed&&<div style={{
        overflow:"hidden", position:"relative",
        touchAction:"none", cursor:"grab",
        padding:"8px 0 12px",
        height: 292,
        flexShrink: 0,
      }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onMouseDown={e => { onTouchStart({touches:[{clientX:e.clientX}]}); }}
        onMouseMove={e => { if(e.buttons!==1)return; onTouchMove({preventDefault:()=>{},touches:[{clientX:e.clientX}]}); }}
        onMouseUp={() => { onTouchEnd(); }}
        onMouseLeave={e => { if(e.buttons===1) onTouchEnd(); }}
      >
        {/* Scrolling row */}
        <div style={{
          display:"flex", alignItems:"flex-start",
          marginLeft:`calc(50% - ${(N + 0.5) * DAY_W}px)`,
          transform:`translateX(${-fracSlot * DAY_W}px)`,
          willChange:"transform",
        }}>
          {dayItems.map(({d, i}) => {
            const k      = toKey(d);
            const isCtr  = i === 0;
            const isTdy  = k === today;
            const dayEvents = (events[k] || []).slice().sort((a,b) => timeToMins(a.time) - timeToMins(b.time));
            const dist = Math.abs(i);
            const opacity = isCtr ? 1 : Math.max(0.12, 1 - Math.pow(dist / 6, 2) * 0.88);

            return (
              <div key={k}
                onClick={() => tapDay(selInt + i)}
                style={{
                  width:DAY_W, flexShrink:0,
                  padding:"4px 3px",
                  cursor: isCtr ? "default" : "pointer",
                  opacity,
                  transition: "opacity 0.15s",
                  borderLeft: isCtr ? `1px solid ${C.accent}20` : "1px solid transparent",
                  borderRight: isCtr ? `1px solid ${C.accent}20` : "1px solid transparent",
                  background: isCtr ? `${C.accent}08` : "transparent",
                  borderRadius: 6,
                  height: 272,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}>
                {/* Date header */}
                <div style={{textAlign:"center", marginBottom:6, paddingTop:2, flexShrink:0}}>
                  <div style={{
                    fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em",
                    color: (isCtr || isTdy) ? C.accent : C.muted,
                    marginBottom:3,
                  }}>{DAY_NAMES[d.getDay()]}</div>
                  <div style={{
                    fontFamily:serif,
                    fontSize: isCtr ? F.md : F.sm,
                    fontWeight: isCtr ? "600" : "normal",
                    lineHeight:1,
                    color: isCtr ? C.text : isTdy ? C.accent : C.muted,
                  }}>{d.getDate()}</div>
                  {/* Health dots */}
                  <div style={{display:"flex",gap:2,justifyContent:"center",marginTop:4,height:4}}>
                    {k<=today && (healthDots[k]?.sleep >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.blue}}/>}
                    {k<=today && (healthDots[k]?.readiness >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.green}}/>}
                    {k<=today && (healthDots[k]?.activity >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:C.accent}}/>}
                    {k<=today && (healthDots[k]?.recovery >= 85) && <div style={{width:3,height:3,borderRadius:"50%",background:"#8B6BB5"}}/>}
                  </div>
                </div>

                {/* Event cards — scrollable, fixed + button below */}
                <div style={{display:"flex",flexDirection:"column",flex:1,minHeight:0}}>
                <div style={{display:"flex",flexDirection:"column",gap:2,
                  overflowY:isCtr?"auto":"hidden",flex:1,minHeight:0,
                  scrollbarWidth:"none",msOverflowStyle:"none"}}>
                  {dayEvents.map((ev,j) => (
                    <div key={j}
                      onClick={isCtr && onEventClick ? (e)=>{e.stopPropagation();onEventClick(ev);} : undefined}
                      style={{
                        padding:"2px 5px", borderRadius:4, flexShrink:0,
                        background:`${ev.color||C.accent}22`,
                        cursor: isCtr && onEventClick ? 'pointer' : 'default',
                        transition:'background 0.1s',
                        opacity: isCtr ? 1 : 0.85,
                      }}
                      onMouseEnter={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||C.accent}38`;}:undefined}
                      onMouseLeave={isCtr&&onEventClick?e=>{e.currentTarget.style.background=`${ev.color||C.accent}22`;}:undefined}
                    >
                      <div style={{fontFamily:mono, fontSize:F.sm, color:`${ev.color||C.accent}`, lineHeight:1.3, opacity: isCtr ? 0.7 : 0.85}}>
                        {ev.time !== "all day" ? ev.time : ""}
                      </div>
                      <div style={{fontFamily:mono, fontSize:F.sm, color:`${ev.color||C.accent}`,
                        lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", opacity: isCtr ? 1 : 0.85}}>
                        {ev.title}
                      </div>
                    </div>
                  ))}

                </div>
                {/* + add button — fixed below scroll, only on selected day */}
                {isCtr && onAddClick && (
                  <button
                    onClick={e=>{e.stopPropagation();onAddClick();}}
                    style={{
                      flexShrink:0,marginTop:4,
                      background:'none',
                      border:`1px solid ${C.border2}`,
                      borderRadius:5,cursor:'pointer',
                      color:C.muted,fontFamily:mono,fontSize:F.sm,
                      letterSpacing:'0.04em',textTransform:'uppercase',
                      padding:'5px 0',width:'100%',textAlign:'center',
                      transition:'all 0.15s',
                    }}
                    onMouseEnter={e=>{e.currentTarget.style.color=C.text;e.currentTarget.style.borderColor=C.text;}}
                    onMouseLeave={e=>{e.currentTarget.style.color=C.muted;e.currentTarget.style.borderColor=C.border2;}}
                  >+ add</button>
                )}
                </div>
              </div>
            );
          })}
        </div>
      </div>}


    </div>
  );
}
function CalStrip({selected, onSelect, events, setEvents, healthDots, token, collapsed, onToggle, calView, onCalViewChange}) {
  const mobile = useIsMobile();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [active,   setActive]  = useState(null);
  const [form,     setForm]    = useState({title:'',startTime:'',endTime:'',allDay:false});
  const [saving,   setSaving]  = useState(false);
  const [deleting, setDeleting]= useState(false);
  const [saveErr,  setSaveErr] = useState('');
  const [dirty,    setDirty]   = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);

  const isNew = active !== null && !active.id;
  const color = active?.color || C.accent;

  const to12h = t => {
    if (!t || t === 'all day') return 'all day';
    try {
      const [h, m] = t.split(':').map(Number);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const h12 = h % 12 || 12;
      return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
    } catch { return t; }
  };

  const toHHMM = t => {
    if (!t || t === 'all day') return '';
    try {
      // Handle "HH:MM" already
      if (/^\d{1,2}:\d{2}$/.test(t.trim())) {
        const [h,m] = t.trim().split(':').map(Number);
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      }
      // Handle "H:MM AM/PM"
      const pm = /pm/i.test(t), am = /am/i.test(t);
      const match = t.match(/(\d{1,2}):(\d{2})/);
      if (match) {
        let h = parseInt(match[1]), m = parseInt(match[2]);
        if (pm && h < 12) h += 12;
        if (am && h === 12) h = 0;
        return String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
      }
      return '';
    } catch { return ''; }
  };

  function openAdd() {
    setActive({});
    setForm({title:'', startTime:'09:00', endTime:'10:00', allDay:false});
    setSaveErr(''); setDirty(false); setEditingTitle(true);
  }

  function openEvent(ev) {
    if (active?.id === ev.id) { closePanel(); return; }
    setActive(ev);
    setForm({
      title: ev.title || '',
      startTime: ev.allDay ? '' : toHHMM(ev.time),
      endTime:   ev.allDay ? '' : toHHMM(ev.endTime),
      allDay:    ev.allDay || ev.time === 'all day',
    });
    setSaveErr(''); setDirty(false); setEditingTitle(false);
  }

  function closePanel() { setActive(null); setSaveErr(''); setDirty(false); }
  function updateForm(patch) {
    setForm(f => {
      const next = {...f, ...patch};
      // When start time changes, adjust end time
      if (patch.startTime && !patch.endTime) {
        const [sh, sm] = patch.startTime.split(':').map(Number);
        const [eh, em] = f.endTime.split(':').map(Number);
        const startMins = sh * 60 + sm;
        const endMins   = eh * 60 + em;
        if (endMins <= startMins) {
          // End is before or equal to start — default to 1 hour later (Google Calendar behavior)
          const newEnd = startMins + 60;
          const nh = Math.floor(newEnd / 60) % 24;
          const nm = newEnd % 60;
          next.endTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
        }
      }
      // When end time is manually set before start, bump end to 1h after start (like Google)
      if (patch.endTime && !patch.startTime) {
        const [sh, sm] = f.startTime.split(':').map(Number);
        const [eh, em] = patch.endTime.split(':').map(Number);
        if (!isNaN(sh) && (eh * 60 + em) <= (sh * 60 + sm)) {
          const newEnd = sh * 60 + sm + 60;
          const nh = Math.floor(newEnd / 60) % 24;
          const nm = newEnd % 60;
          next.endTime = `${String(nh).padStart(2,'0')}:${String(nm).padStart(2,'0')}`;
        }
      }
      return next;
    });
    setDirty(true);
  }

  async function save() {
    if (!form.title.trim() || saving) return;
    setSaving(true); setSaveErr('');
    try {
      if (isNew) {
        const res = await fetch('/api/calendar-create', {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body: JSON.stringify({title:form.title.trim(),date:selected,
            startTime:form.allDay?'':form.startTime,endTime:form.allDay?'':form.endTime,
            allDay:form.allDay,tz}),
        });
        const data = await res.json();
        if (!res.ok||data.error){ setSaveErr(data.error||'Failed'); setSaving(false); return; }
        setEvents(prev=>({...prev,[selected]:[...(prev[selected]||[]),
          {id:data.eventId,title:form.title.trim(),
           time:form.allDay?'all day':to12h(form.startTime),
           endTime:form.allDay?null:to12h(form.endTime),allDay:form.allDay,color:'#B8A882'}]}));
        closePanel();
      } else {
        const res = await fetch('/api/calendar-update', {
          method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body: JSON.stringify({eventId:active.id,title:form.title.trim(),date:selected,
            startTime:form.allDay?'':form.startTime,endTime:form.allDay?'':form.endTime,
            allDay:form.allDay,tz}),
        });
        const data = await res.json();
        if (!res.ok||data.error){ setSaveErr(data.error||'Failed'); setSaving(false); return; }
        const updated = {...active,title:form.title.trim(),
          time:form.allDay?'all day':to12h(form.startTime),
          endTime:form.allDay?null:to12h(form.endTime),allDay:form.allDay};
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).map(e=>e.id===active.id?updated:e)}));
        setActive(updated); setDirty(false);
      }
    } catch(err){ setSaveErr(err.message); }
    setSaving(false);
  }

  async function deleteEvent() {
    if (!active?.id||deleting) return;
    setDeleting(true);
    const snapshot = {...active}; // capture before deletion
    const dateSnap = selected;
    try {
      const res = await fetch('/api/calendar-delete', {
        method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
        body: JSON.stringify({eventId:active.id}),
      });
      if (res.ok) {
        setEvents(prev=>({...prev,[selected]:(prev[selected]||[]).filter(e=>e.id!==active.id)}));
        closePanel();
        // Push undo entry — re-create the event
        pushHistory({
          label: `Delete "${snapshot.title}"`,
          undo: async () => {
            const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            const r = await fetch('/api/calendar-create', {
              method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
              body: JSON.stringify({title:snapshot.title, date:dateSnap,
                startTime: snapshot.allDay?'':toHHMM(snapshot.time),
                endTime: snapshot.allDay?'':toHHMM(snapshot.endTime),
                allDay:snapshot.allDay||snapshot.time==='all day', tz}),
            });
            const d = await r.json();
            if (r.ok && d.eventId) {
              const restored = {...snapshot, id:d.eventId};
              setEvents(prev=>({...prev,[dateSnap]:[...(prev[dateSnap]||[]).filter(e=>e.id!==snapshot.id&&e.id!==d.eventId), restored]}));
            }
          },
          redo: async () => {
            await fetch('/api/calendar-delete', {
              method:'POST', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
              body: JSON.stringify({eventId:snapshot.id}),
            });
            setEvents(prev=>({...prev,[dateSnap]:(prev[dateSnap]||[]).filter(e=>e.id!==snapshot.id)}));
          },
        });
      }
    } catch{} finally{ setDeleting(false); }
  }

  const prevSelected = useRef(selected);
  useEffect(()=>{
    if(prevSelected.current!==selected){ prevSelected.current=selected; closePanel(); }
  },[selected]); // eslint-disable-line

  const inputBase = {
    background:'transparent', border:'none', outline:'none',
    padding:0, margin:0, color:C.text,
  };

  // Derive selected date info for header pill
  const selDateObj = selected ? new Date(selected + 'T12:00:00') : new Date();
  const isSelToday = selected === todayKey();
  const pillColor = isSelToday ? C.text : C.accent;
  const SEL_MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const selPillLabel = `${SEL_MONTHS[selDateObj.getMonth()]} ${selDateObj.getDate()}, ${selDateObj.getFullYear()}`;

  return (
    <Card>
      {calView === 'month' ? (
        <div style={{userSelect:'none',display:'flex',flexDirection:'column'}}>
          {/* Month header — same layout as day view */}
          <div style={{display:'flex',alignItems:'center',padding:'10px 16px 8px',
            borderBottom:`1px solid ${C.border}`,flexShrink:0,position:'relative',
            cursor:onToggle?'pointer':'default'}} onClick={onToggle}>
            <div style={{display:'flex',alignItems:'center',gap:8,flexShrink:0}}>
              {onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>}
              <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.muted}}>Calendar</span>
            </div>
            {collapsed ? (
              /* Collapsed: always day nav — same as day view */
              <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',
                display:'flex',alignItems:'center',gap:10,userSelect:'none',whiteSpace:'nowrap'}}>
                <button onClick={e=>{e.stopPropagation();const n=new Date(selDateObj);n.setDate(n.getDate()-1);onSelect(toKey(n));}}
                  style={{background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'2px 6px',
                    fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.text}
                  onMouseLeave={e=>e.currentTarget.style.color=C.muted}>‹</button>
                <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.1em',textTransform:'uppercase',
                  color:pillColor,background:pillColor+'1A',borderRadius:6,padding:'4px 10px'}}>
                  {selPillLabel}
                </span>
                <button onClick={e=>{e.stopPropagation();const n=new Date(selDateObj);n.setDate(n.getDate()+1);onSelect(toKey(n));}}
                  style={{background:'none',border:'none',cursor:'pointer',color:C.muted,padding:'2px 6px',
                    fontFamily:mono,fontSize:F.md,lineHeight:1,transition:'color 0.15s'}}
                  onMouseEnter={e=>e.currentTarget.style.color=C.text}
                  onMouseLeave={e=>e.currentTarget.style.color=C.muted}>›</button>
              </div>
            ) : (
              /* Expanded: selected date pill only */
              <div style={{position:'absolute',left:'50%',transform:'translateX(-50%)',pointerEvents:'none',userSelect:'none',whiteSpace:'nowrap'}}>
                <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.1em',textTransform:'uppercase',
                  color:pillColor,background:pillColor+'1A',borderRadius:6,padding:'4px 10px'}}>
                  {selPillLabel}
                </span>
              </div>
            )}
            {/* M/D toggle — right, hidden when collapsed */}
            <div style={{marginLeft:'auto',display:'flex',gap:4}} onClick={e=>e.stopPropagation()}>
              {!collapsed && <>
              <button onClick={()=>onCalViewChange('month')}
                style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                  padding:'3px 8px',borderRadius:4,cursor:'pointer',
                  minHeight:22,minWidth:22,
                  background:C.accent+'22',border:`1px solid ${C.accent}`,color:C.accent}}>M</button>
              <button onClick={()=>onCalViewChange('day')}
                style={{fontFamily:mono,fontSize:'10px',letterSpacing:'0.06em',
                  padding:'3px 8px',borderRadius:4,cursor:'pointer',
                  minHeight:22,minWidth:22,
                  background:'none',border:`1px solid ${C.border2}`,color:C.muted}}>D</button>
              </>}
            </div>
          </div>
          {!collapsed&&<MonthView
            initYear={selDateObj.getFullYear()} initMonth={selDateObj.getMonth()}
            selected={selected}
            onSelectDay={d=>onSelect(d)}
            onMonthChange={()=>{}}
            healthDots={healthDots}
            events={events}
            token={token}
          />}
        </div>
      ) : (
        <MobileCalPicker
          selected={selected} onSelect={onSelect}
          events={events} healthDots={healthDots} desktop={!mobile}
          onEventClick={openEvent} onAddClick={openAdd}
          collapsed={collapsed} onToggle={onToggle}
          calView={calView} onCalViewChange={onCalViewChange}
        />
      )}

      {/* ── Event panel ── */}
      {active !== null && (
        <div style={{borderTop:`1px solid ${C.border}`,padding:'12px 16px'}}>

          {/* Main row: color bar | info | delete | × */}
          <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>

            {/* Color bar */}
            <div style={{width:3,borderRadius:2,background:color,
              flexShrink:0,alignSelf:'stretch',minHeight:34,marginTop:2}}/>

            {/* Info: title + time row */}
            <div style={{flex:1,minWidth:0}}>
              {/* Title */}
              {editingTitle ? (
                <input
                  autoFocus
                  value={form.title}
                  onChange={e=>updateForm({title:e.target.value})}
                  onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();save();setEditingTitle(false);}if(e.key==='Escape')closePanel();}}
                  onBlur={()=>setEditingTitle(false)}
                  placeholder='Event title'
                  style={{...inputBase,fontFamily:serif,fontSize:F.md,width:'100%',
                    display:'block',marginBottom:5}}
                />
              ) : (
                <div
                  onClick={()=>setEditingTitle(true)}
                  style={{fontFamily:serif,fontSize:F.md,color:form.title?C.text:C.muted,
                    marginBottom:5,cursor:'text',minHeight:'1.4em'}}
                >
                  {form.title || 'Event title'}
                </div>
              )}

              {/* Time row: times + All Day inline */}
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {/* Time inputs — hidden when allDay */}
                <div style={{
                  display:'flex',alignItems:'center',gap:5,
                  maxWidth:form.allDay?0:240,
                  overflow:'hidden',
                  opacity:form.allDay?0:1,
                  transition:'max-width 0.25s ease, opacity 0.2s ease',
                }}>
                  <input type='time' value={form.startTime}
                    onChange={e=>updateForm({startTime:e.target.value})}
                    style={{...inputBase,fontFamily:mono,fontSize:F.sm,color:C.muted,
                      width:96,cursor:'text'}}
                  />
                  <span style={{fontFamily:mono,fontSize:F.sm,color:C.muted,opacity:0.4}}>–</span>
                  <input type='time' value={form.endTime}
                    onChange={e=>updateForm({endTime:e.target.value})}
                    style={{...inputBase,fontFamily:mono,fontSize:F.sm,color:C.muted,
                      width:96,cursor:'text'}}
                  />
                </div>

                {/* All Day toggle */}
                <button onClick={()=>updateForm({allDay:!form.allDay})} style={{
                  background:'none',border:'none',cursor:'pointer',padding:0,
                  fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',textTransform:'uppercase',
                  color:form.allDay?C.accent:C.muted,
                  transition:'color 0.2s',
                }}
                onMouseEnter={e=>{if(!form.allDay)e.currentTarget.style.color=C.text;}}
                onMouseLeave={e=>{if(!form.allDay)e.currentTarget.style.color=C.muted;}}>
                  all day
                </button>

                {saving && <span style={{fontFamily:mono,fontSize:F.sm,color:C.muted,opacity:0.5}}>saving…</span>}
              </div>



              {active.zoomUrl && (
                <a href={active.zoomUrl} target='_blank' rel='noopener noreferrer'
                  style={{display:'inline-block',marginTop:6,fontFamily:mono,fontSize:F.sm,
                    letterSpacing:'0.1em',textTransform:'uppercase',color:C.blue,textDecoration:'none'}}>
                  Join ↗
                </a>
              )}
            </div>

            {/* Right side: trash | cancel | save — horizontal row */}
            <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0,alignSelf:'center'}}>
              {/* Trash — existing events only */}
              {!isNew && active.id && (
                <button onClick={deleteEvent} disabled={deleting} title="Delete" style={{
                  background:'none',border:'none',cursor:deleting?'default':'pointer',
                  color:C.red,padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                  opacity:deleting?0.3:0.6,transition:'color 0.15s, opacity 0.15s',
                }}
                onMouseEnter={e=>{if(!deleting){e.currentTarget.style.opacity='1';e.currentTarget.style.color=C.red;}}}
                onMouseLeave={e=>{e.currentTarget.style.opacity='0.6';e.currentTarget.style.color=C.red;}}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              )}
              {/* Cancel × */}
              <button onClick={closePanel} title="Cancel" style={{
                background:'none',border:'none',cursor:'pointer',
                color:C.muted,padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                opacity:0.6,transition:'color 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e=>{e.currentTarget.style.opacity='1';e.currentTarget.style.color=C.text;}}
              onMouseLeave={e=>{e.currentTarget.style.opacity='0.6';e.currentTarget.style.color=C.muted;}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
              {/* Save ✓ */}
              <button onClick={async()=>{if(form.title.trim()){await save();closePanel();}}} disabled={saving||!form.title.trim()} title="Save" style={{
                background:'none',border:'none',cursor:(saving||!form.title.trim())?'default':'pointer',
                color:C.muted,padding:6,lineHeight:0,display:'flex',alignItems:'center',justifyContent:'center',
                opacity:(saving||!form.title.trim())?0.3:0.6,transition:'color 0.15s, opacity 0.15s',
              }}
              onMouseEnter={e=>{if(!saving&&form.title.trim()){e.currentTarget.style.opacity='1';e.currentTarget.style.color=C.green;}}}
              onMouseLeave={e=>{e.currentTarget.style.opacity=(saving||!form.title.trim())?'0.3':'0.6';e.currentTarget.style.color=C.muted;}}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>

          </div>

          {saveErr && <div style={{fontFamily:mono,fontSize:F.sm,color:'#A05050',marginTop:8}}>{saveErr}</div>}
        </div>
      )}
    </Card>
  );
}
// ─── Skeleton shimmer ─────────────────────────────────────────────────────────
function Shimmer({width="100%", height=14, style={}}) {
  return (
    <div style={{
      width, height, borderRadius:4,
      background:`linear-gradient(90deg, ${C.border} 25%, ${C.border2} 50%, ${C.border} 75%)`,
      backgroundSize:"200% 100%",
      animation:"shimmer 1.4s infinite",
      ...style,
    }}/>
  );
}

// ─── HealthStrip ──────────────────────────────────────────────────────────────
const H_EMPTY={sleepScore:"",sleepHrs:"",sleepEff:"",readinessScore:"",hrv:"",rhr:"",activityScore:"",activeCalories:"",totalCalories:"",steps:"",activeMinutes:"",resilienceScore:"",stressMins:"",recoveryMins:""};

const SPORT_EMOJI = {
  Run:"🏃",Ride:"🚴",Swim:"🏊",Walk:"🚶",Hike:"🥾",
  WeightTraining:"🏋️",Yoga:"🧘",Workout:"💪",
  VirtualRide:"🚴",VirtualRun:"🏃",Soccer:"⚽",
  Rowing:"🚣",Kayaking:"🛶",Surfing:"🏄",
  Snowboard:"🏂",AlpineSki:"⛷️",NordicSki:"⛷️",
  default:"🏅",
};
function sportEmoji(type){
  if(!type)return SPORT_EMOJI.default;
  const k=Object.keys(SPORT_EMOJI).find(k=>k.toLowerCase()===type.toLowerCase().replace(/_/g,""));
  return SPORT_EMOJI[k]||SPORT_EMOJI.default;
}

function fmtMins(val) {
  const m = parseInt(val)||0;
  if (!m) return "—";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m/60), rem = m%60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}
function fmtMinsField(val) {
  const m = parseInt(val)||0;
  if (!m) return {value:"—", unit:""};
  if (m < 60) return {value:String(m), unit:"m"};
  const h = Math.floor(m/60), rem = m%60;
  return rem ? {value:`${h}h ${rem}`, unit:"m"} : {value:String(h), unit:"h"};
}


function HealthStrip({date,token,userId,onHealthChange,onScoresReady,onSyncStart,onSyncEnd,collapsed,onToggle,backAction}) {
  const {value:h,setValue:setH,loaded}=useDbSave(date,"health",H_EMPTY,token,userId);
  const [dataSource, setDataSource] = useState(null); // null | 'oura' | 'apple' | 'both'

  // Reset to empty immediately on date change — never show stale previous-day data
  const prevHealthDate = useRef(date);
  useEffect(()=>{
    if(prevHealthDate.current !== date){
      prevHealthDate.current = date;
      setH(H_EMPTY);
    }
  },[date]); // eslint-disable-line

  useEffect(()=>{if(loaded)onHealthChange(date,h);},[h,loaded]); // eslint-disable-line

  useEffect(()=>{
    if(!loaded||!token)return;
    // Never fetch Oura for future dates — no data exists and the wide session window
    // would incorrectly pull today's sleep data onto tomorrow's date
    if(date > todayKey()) { onSyncEnd("oura"); return; }
    onSyncStart("oura");
    cachedOuraFetch(date, token, userId).then(async data=>{
        if(data.error==="no_token") {
          // No Oura — try Garmin first, then fall back to Apple Health
          const garminData = await fetch(`/api/garmin?date=${date}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()).catch(()=>({}));
          if(garminData && !garminData.error && Object.keys(garminData).length > 0) {
            setH(p=>({...p,
              sleepHrs:       garminData.sleepHrs        ?? "",
              sleepEff:       garminData.sleepQuality     ?? "",
              hrv:            garminData.hrv              ?? "",
              rhr:            garminData.rhr              ?? "",
              activeCalories: garminData.activeCalories   ?? "",
              totalCalories:  garminData.totalCalories    ?? "",
              steps:          garminData.steps            ?? "",
              activeMinutes:  garminData.activeMinutes    ?? "",
            }));
            setDataSource("garmin");
            onSyncEnd("oura"); return;
          }
          // No Garmin either — fall back to Apple Health data synced from iOS app
          const sb = createClient(); // singleton — already imported at top
          const {data:row} = await sb.from("entries").select("data")
            .eq("type","health_apple").eq("date",date).eq("user_id",userId).maybeSingle();
          if(row?.data) {
            const d = row.data;
            setH(p=>({...p,
              sleepHrs:       d.sleepHrs       ?? "",
              sleepEff:       d.sleepEff       ?? "",
              hrv:            d.hrv            ?? "",
              rhr:            d.rhr            ?? "",
              activeCalories: d.activeCalories ?? "",
              totalCalories:  d.totalCalories  ?? "",
              steps:          d.steps          ?? "",
              activeMinutes:  d.activeMinutes  ?? "",
            }));
            setDataSource("apple");
          }
          onSyncEnd("oura"); return;
        }
        if(data.error){ onSyncEnd("oura"); return; }
        // Oura connected — also check if Apple Health has data for this date (could have both)
        const sb2 = createClient(); // singleton — safe to call multiple times
        const {data:appleRow} = await sb2.from("entries").select("date")
          .eq("type","health_apple").eq("date",date).eq("user_id",userId).maybeSingle();
        setDataSource(appleRow ? "both" : "oura");
        // Nullish coalescing: only set a field if Oura returned a real value.
        // Never fall back to p.x — if Oura has no data for this date, leave it blank.
        setH(p=>({...p,
          sleepScore:     data.sleepScore      ?? "",
          sleepHrs:       data.sleepHrs        ?? "",
          sleepEff:       data.sleepQuality    ?? "",
          readinessScore: data.readinessScore  ?? "",
          hrv:            data.hrv             ?? "",
          rhr:            data.rhr             ?? "",
          activityScore:  data.activityScore   ?? "",
          activeCalories: data.activeCalories  ?? "",
          totalCalories:  data.totalCalories   ?? "",
          steps:          data.steps           ?? "",
          activeMinutes:  data.activeMinutes   ?? "",
          resilienceScore:data.resilienceScore ?? "",
          stressMins:     data.stressMins      ?? "",
          recoveryMins:   data.recoveryMins    ?? "",
        }));
      }).catch(()=>{}).finally(()=>onSyncEnd("oura"));
  },[date,loaded,token]); // eslint-disable-line


  const purple = "#8B6BB5";

  // ── Computed scores from /api/scores ──────────────────────────────────────
  const [scores, setScores] = useState(null);
  const prevScoreDate = useRef(date);
  useEffect(()=>{
    if(prevScoreDate.current !== date){ prevScoreDate.current = date; setScores(null); }
  },[date]);

  // ── Apple Health connect prompt (iOS only) ────────────────────────────────
  const [hkStatus, setHkStatus] = useState(null); // null | 'not_determined' | 'authorized' | 'denied'
  useEffect(()=>{
    if(typeof window === 'undefined') return;
    const handler = e => setHkStatus(e.detail?.status ?? null);
    window.addEventListener('daylabHealthKit', handler);
    return () => window.removeEventListener('daylabHealthKit', handler);
  },[]);

  const connectAppleHealth = () => {
    // Send message to iOS native layer — include token so native doesn't need to re-fetch it
    if(window.webkit?.messageHandlers?.daylabRequestHealthKit) {
      window.webkit.messageHandlers.daylabRequestHealthKit.postMessage({token: token||localStorage.getItem('daylab:token')||''});
    }
  };

  // Stable fingerprint — only refetch scores when the fields that affect computation change
  const scoreFingerprint = loaded
    ? [h.sleepHrs,h.sleepEff,h.hrv,h.rhr,h.steps,h.activeMinutes].join(':')
    : null;

  useEffect(()=>{
    // Wait until h is loaded from DB — prevents H_EMPTY first-fire from corrupting dots
    if(!token||!loaded||scoreFingerprint===null) return;
    if(date > todayKey()) return; // never request scores for future dates
    const ctrl = new AbortController();
    const tzOffset = new Date().getTimezoneOffset() * -1;
    const p = new URLSearchParams({ date, tzOffset });
    if(h.sleepHrs)       p.set('sleepHrs',      h.sleepHrs);
    if(h.sleepEff)       p.set('sleepEff',       h.sleepEff);
    if(h.hrv)            p.set('hrv',            h.hrv);
    if(h.rhr)            p.set('rhr',            h.rhr);
    if(h.steps)          p.set('steps',          h.steps);
    if(h.activeMinutes)  p.set('activeMinutes',  h.activeMinutes);
    fetch(`/api/scores?${p}`,{signal:ctrl.signal,headers:{Authorization:`Bearer ${token}`}})
      .then(r=>r.json()).then(d=>{
        if(!d.error){
          setScores(d);
          if(d.sleep?.score != null || d.readiness?.score != null || d.activity?.score != null || d.recovery?.score != null){
            onScoresReady(date, d);
          }
        }
      }).catch(e=>{ if(e.name!=='AbortError') console.warn('scores fetch',e); });
    return ()=>ctrl.abort();
  },[date,token,scoreFingerprint,loaded]); // eslint-disable-line

  // ── Sparkline SVG ─────────────────────────────────────────────────────────
  function Sparkline({data, color, width=52, height=20}) {
    const raw = data || [];
    // Keep only non-null entries with their original index (preserves time position)
    const pts = raw.map((v,i) => v!=null ? {v,i} : null).filter(Boolean);
    if(pts.length < 2) return <div style={{width,height}}/>;
    const vals = pts.map(p=>p.v);
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const range = mx - mn || 1;
    const total = raw.length - 1 || 1;
    const xs = pts.map(p => (p.i/total)*(width-2)+1);
    const ys = pts.map(p => height-1 - ((p.v-mn)/range)*(height-2));
    return (
      <svg width={width} height={height} style={{display:'block',overflow:'visible',marginLeft:8}}>
        <polyline points={xs.map((x,i)=>`${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')}
          fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7"/>
        <circle cx={xs[xs.length-1].toFixed(1)} cy={ys[ys.length-1].toFixed(1)} r="2" fill={color}/>
      </svg>
    );
  }

  const calibDays = scores?.calibrationDays ?? 0;
  const showBadge = calibDays > 0 && calibDays < 14;

  const metrics=[
    {key:"sleep",    label:"Sleep",    color:C.blue,  score:scores?.sleep?.score,
      fields:[{label:"Hours",value:h.sleepHrs,unit:"h",ck:"sleepHrs"},{label:"Effic.",value:h.sleepEff,unit:"%",ck:"efficiency"}],
      sparkline:scores?.sleep?.sparkline},
    {key:"readiness",label:"Readiness",color:C.green, score:scores?.readiness?.score,
      fields:[{label:"HRV",value:h.hrv,unit:"ms",ck:"hrv"},{label:"RHR",value:h.rhr,unit:"bpm",ck:"rhr"}],
      sparkline:scores?.readiness?.sparkline},
    {key:"activity", label:"Activity", color:C.accent,score:scores?.activity?.score,
      fields:[{label:"Steps",value:h.steps?Number(h.steps).toLocaleString():"",ck:"steps"},{label:"Active",value:h.activeMinutes,unit:"min",ck:"activeMinutes"}],
      sparkline:scores?.activity?.sparkline},
    {key:"recovery", label:"Recovery", color:purple,  score:scores?.recovery?.score,
      fields:[{label:"Calm",value:h.recoveryMins?String(Math.round(+h.recoveryMins)):"",unit:h.recoveryMins?"min":"",ck:"hrvTrend"},{label:"Stress",value:h.stressMins?String(Math.round(+h.stressMins)):"",unit:h.stressMins?"min":"",ck:"rhrTrend"}],
      sparkline:scores?.recovery?.sparkline},
  ];

  // ── Trend panel state ──────────────────────────────────────────────────────
  const [expandedMetric, setExpandedMetric] = useState(null);  // controls trend
  const [breakdownMetric, setBreakdownMetric] = useState(null); // controls score breakdown
  const [trendRange,     setTrendRange]     = useState("30d"); // "30d" | "12m"
  const [trendData, setTrendData]           = useState({});
  const [trendLoading, setTrendLoading]     = useState(false);

  useEffect(() => {
    if (!expandedMetric || !token || !userId || !date) return;
    const days = trendRange === "12m" ? 364 : 29;
    const cacheKey = `${expandedMetric}:${date}:${trendRange}`;
    if (trendData[cacheKey]) return;
    setTrendLoading(true);
    const supabase = createClient();
    const anchorDate = new Date(date + 'T12:00:00');
    const since = toKey(shift(anchorDate, -days));
    supabase
      .from('entries').select('date,data')
      .eq('user_id', userId).eq('type', 'scores')
      .gte('date', since).lte('date', date)
      .order('date', { ascending: true })
      .then(({ data: rows }) => {
        if (!rows) { setTrendLoading(false); return; }
        const map = {};
        rows.forEach(row => {
          if (!row.date || !row.data) return;
          map[row.date] = {
            sleep:     +row.data.sleepScore     || null,
            readiness: +row.data.readinessScore || null,
            activity:  +row.data.activityScore  || null,
            recovery:  +row.data.recoveryScore  || null,
          };
        });
        setTrendData(prev => ({ ...prev, [cacheKey]: map }));
        setTrendLoading(false);
      }).catch(() => setTrendLoading(false));
  }, [expandedMetric, trendRange, date, token, userId]); // eslint-disable-line

  const TREND_INFO = {
    sleep: {
      what: "Measures how restorative last night's sleep was — combining total hours, efficiency, and physiological recovery signals like HRV and resting heart rate.",
      how:  "Weighted blend: sleep duration (7–9h = 100), efficiency (>85% = 100), and HRV/RHR deviation from your personal baseline. Calibrates to your patterns after 14 days.",
    },
    readiness: {
      what: "Reflects your body's recovery state and readiness to perform — how well you've bounced back from recent stress, training, and sleep debt.",
      how:  "Derived from HRV and RHR compared to your rolling 14-day baseline. Higher HRV + lower RHR = higher readiness. Penalizes multi-day downward trends.",
    },
    activity: {
      what: "Tracks daily movement and physical exertion — steps, active time, and calories burned relative to your typical output.",
      how:  "Combines steps (goal: 8,000–10,000), active minutes (WHO: 22/day), and active calories. Scores your activity relative to your personal weekly average after calibration.",
    },
    recovery: {
      what: "Measures stress-recovery balance — the ratio of calm physiological state to stress burden across the day and overnight.",
      how:  "Uses calm vs. stress minutes from Oura (autonomic nervous system balance) when available, otherwise falls back to HRV/RHR trends as a proxy for allostatic load.",
    },
  };

  // Build trend SVG line anchored to date, range = "30d" | "12m"
  function TrendLine({ metricKey, color }) {
    const cacheKey = `${metricKey}:${date}:${trendRange}`;
    const data = trendData[cacheKey];
    if (!data || trendLoading) {
      return (
        <div style={{ height: 94, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: mono, fontSize: F.sm, color: C.dim }}>{trendLoading ? 'loading…' : '—'}</span>
        </div>
      );
    }
    const span = trendRange === "12m" ? 364 : 29;
    const anchorDate = new Date(date + 'T12:00:00');
    const days = [];
    for (let i = -span; i <= 0; i++) days.push(toKey(shift(anchorDate, i)));
    const vals = days.map(d => data[d]?.[metricKey] ?? null);
    const pts = vals.map((v, i) => v != null ? { v, i } : null).filter(Boolean);
    if (pts.length < 2) return <div style={{ height: 94, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span style={{ fontFamily: mono, fontSize: F.sm, color: C.dim }}>not enough data</span></div>;

    const W = 600, H = 80;
    const mn = Math.max(0, Math.min(...pts.map(p => p.v)) - 5);
    const mx = Math.min(100, Math.max(...pts.map(p => p.v)) + 5);
    const range = mx - mn || 1;
    const xOf = i => (i / span) * W;
    const yOf = v => H - ((v - mn) / range) * (H - 6) - 3;

    const linePts = pts.map(p => `${xOf(p.i).toFixed(1)},${yOf(p.v).toFixed(1)}`).join(' ');
    const first = pts[0], last = pts[pts.length - 1];
    const fillPath = `M${xOf(first.i).toFixed(1)},${H} L${linePts.split(' ').join(' L')} L${xOf(last.i).toFixed(1)},${H} Z`;

    const avg = pts.reduce((s, p) => s + p.v, 0) / pts.length;
    const avgY = yOf(avg).toFixed(1);

    // ── X-axis ticks ──────────────────────────────────────────────────────────
    // 12M: every month (Jan, Feb…) — up to 12 labels
    // 30D: every Monday — typically 4-5 labels
    // 7D:  every day except today
    // Right-edge guard: drop any tick whose left% is within 10% of right edge
    //   to prevent collision with the fixed endLabel
    // Min-gap guard: drop ticks that are within 6% of the previous tick
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rawTicks = [];
    if (trendRange === "12m") {
      days.forEach((d, i) => {
        if (d.slice(8) === '01') {
          rawTicks.push({ i, label: MONTHS[parseInt(d.split('-')[1]) - 1] });
        }
      });
    } else if (trendRange === "30d") {
      days.forEach((d, i) => {
        const dow = new Date(d + 'T12:00:00').getDay();
        if (dow === 1) {
          const dt = new Date(d + 'T12:00:00');
          rawTicks.push({ i, label: `${MONTHS[dt.getMonth()]} ${dt.getDate()}` });
        }
      });
    } else {
      days.forEach((d, i) => {
        if (i === span) return;
        const dt = new Date(d + 'T12:00:00');
        rawTicks.push({ i, label: `${MONTHS[dt.getMonth()]} ${dt.getDate()}` });
      });
    }
    // Filter: remove ticks too close to each other (min 6% gap)
    // No right-edge guard needed — endLabel is gone, dot marks the end
    const ticks = [];
    for (const t of rawTicks) {
      const pct = (t.i / span) * 100;
      if (ticks.length > 0 && pct - (ticks[ticks.length-1].i / span) * 100 < 6) continue;
      ticks.push(t);
    }

    return (
      <div style={{ padding: '0 0 4px' }}>
        <div style={{ position: 'relative' }}>
          <svg viewBox={`0 0 ${W} ${H + 10}`} style={{ width: '100%', height: 88, display: 'block', overflow: 'visible' }}
            preserveAspectRatio="none">
            <defs>
              <linearGradient id={`tg-${metricKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.22"/>
                <stop offset="100%" stopColor={color} stopOpacity="0"/>
              </linearGradient>
            </defs>
            <path d={fillPath} fill={`url(#tg-${metricKey})`} stroke="none"/>
            <line x1="0" y1={avgY} x2={W} y2={avgY}
              stroke="rgba(255,255,255,0.2)" strokeWidth="1"
              strokeDasharray="4,4" vectorEffect="non-scaling-stroke"/>
            <polyline points={linePts} fill="none" stroke={color} strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke"/>
            {/* X-axis tick marks */}
            {ticks.map(t => (
              <line key={t.i}
                x1={xOf(t.i)} y1={H} x2={xOf(t.i)} y2={H + 4}
                stroke="rgba(255,255,255,0.18)" strokeWidth="1"
                vectorEffect="non-scaling-stroke"/>
            ))}
          </svg>

          {/* Today dot */}
          <div style={{
            position: 'absolute',
            left: `${(last.i / span) * 100}%`,
            top: `${(yOf(last.v) / H) * 80}px`,
            transform: 'translate(-50%, -50%)',
            width: 7, height: 7, borderRadius: '50%',
            background: color,
            pointerEvents: 'none',
          }}/>
        </div>

        {/* X-axis labels row */}
        <div style={{ position: 'relative', height: 14, marginTop: -2 }}>
          {ticks.map(t => {
            const leftPct = (t.i / span) * 100;
            // Avoid clipping at edges
            const transform = leftPct < 8 ? 'none' : leftPct > 92 ? 'translateX(-100%)' : 'translateX(-50%)';
            return (
              <div key={t.i} style={{
                position: 'absolute',
                left: `${leftPct}%`,
                transform,
                fontFamily: mono, fontSize: '9px', color: C.dim,
                letterSpacing: '0.04em', lineHeight: 1,
              }}>{t.label}</div>
            );
          })}

        </div>
      </div>
    );
  }

  return (
    <Card fitContent={!onToggle} style={collapsed?{height:"auto"}:{}}>
      {/* Card header */}
      <div style={{display:"flex",alignItems:"center",gap:8,padding:"11px 14px",
        borderBottom:collapsed?"none":`1px solid ${C.border}`,flexShrink:0,
        cursor:onToggle?"pointer":"default"}} onClick={backAction?undefined:onToggle}>
        {backAction
          ? <button onClick={backAction} style={{background:"none",border:"none",cursor:"pointer",color:C.green,padding:0,display:"flex",alignItems:"center",gap:4,fontFamily:mono,fontSize:F.sm,marginRight:2}}>←</button>
          : onToggle&&<ChevronBtn collapsed={collapsed} onToggle={e=>{e.stopPropagation();onToggle();}}/>
        }
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
          textTransform:"uppercase",color:backAction?C.green:C.muted,flex:1}}>Health</span>
        {dataSource&&(
          <span style={{fontFamily:mono,fontSize:"10px",color:C.dim,
            border:`1px solid ${C.border}`,borderRadius:4,padding:"1px 5px"}}>
            {dataSource==="both"?"Oura + Apple Health":dataSource==="apple"?"Apple Health":dataSource==="garmin"?"Garmin":"Oura"}
          </span>
        )}
        {showBadge&&(
          <span title={`Scores calibrating — ${calibDays}/14 days of data. Currently using health guidelines as reference.`}
            style={{fontFamily:mono,fontSize:"10px",color:C.muted,background:"rgba(255,255,255,0.06)",
              borderRadius:4,padding:"1px 6px",cursor:"default"}}>
            Calibrating…
          </span>
        )}
      </div>
      {/* Apple Health connect prompt — iOS only, shown when not yet authorized */}
      {hkStatus==="not_determined"&&!collapsed&&(
        <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.border}`}}>
          <button onClick={connectAppleHealth}
            style={{fontFamily:mono,fontSize:F.sm,color:C.blue,background:"none",border:`1px solid ${C.blue}`,
              borderRadius:6,cursor:"pointer",padding:"5px 12px",letterSpacing:"0.03em",opacity:0.9}}>
            Connect
          </button>
        </div>
      )}
      {/* Metrics row */}
      {!collapsed&&<div style={{position:"relative"}}>
      <div style={{display:"flex",alignItems:"stretch",overflowX:"auto",scrollbarWidth:"none",msOverflowStyle:"none",
        borderBottom:expandedMetric?`1px solid ${C.border}`:"none",position:"relative"}} ref={el=>{
          if(!el) return;
          const upd=()=>{const f=el.parentElement?.querySelector('.hs-fade');if(f){const atEnd=el.scrollLeft+el.clientWidth>=el.scrollWidth-2;f.style.opacity=(el.scrollWidth>el.clientWidth+2&&!atEnd)?'1':'0';}};
          el._hsCheck=upd; upd(); const ro=new ResizeObserver(upd); ro.observe(el);
          el.addEventListener('scroll',upd);
        }}>
        {metrics.map((m,mi)=>{
          const isTrend     = expandedMetric  === m.key;
          const isDimmed = expandedMetric && !isTrend;
          return (
            <div key={m.key}
              onClick={()=>{ isTrend ? setExpandedMetric(null) : setExpandedMetric(m.key); }}
              style={{flex:"1 0 auto",minWidth:120,display:"flex",alignItems:"center",gap:12,
                borderRight:mi<metrics.length-1?`1px solid ${C.border}`:"none",
                boxSizing:"border-box", overflow:"hidden",
                padding:"12px 14px",cursor:"pointer",
                background: isTrend ? m.color+"0D" : "transparent",
                borderBottom: isTrend ? `2px solid ${m.color}` : "2px solid transparent",
                opacity: isDimmed ? 0.45 : 1,
                transition:"background 0.2s, opacity 0.2s",
              }}>
              <div style={{flexShrink:0}}>
                <Ring score={m.score} color={m.color} size={48}/>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
                  <div style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:m.color}}>{m.label}</div>
                  {m.sparkline && (
                    <Sparkline data={m.sparkline} color={m.color} width={46} height={18}/>
                  )}
                </div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
                  {m.fields.map(f=>{
                    const sub = f.ck ? (scores?.[m.key]?.contributors?.[f.ck] ?? null) : null;
                    const hasVal = f.value && f.value !== "—" && f.value !== "";
                    const fc = !hasVal ? C.dim : sub == null ? C.dim : sub >= 70 ? C.green : sub < 45 ? C.red : C.muted;
                    return (
                      <div key={f.label}>
                        <div style={{fontFamily:mono,fontSize:F.sm,textTransform:"uppercase",color:C.dim,marginBottom:1,letterSpacing:"0.04em"}}>{f.label}</div>
                        <div style={{display:"flex",alignItems:"baseline",gap:2}}>
                          <span style={{fontFamily:serif,fontSize:F.md,color:fc}}>{f.value||"—"}</span>
                          {f.unit&&<span style={{fontFamily:mono,fontSize:F.sm,color:fc,opacity:0.7}}>{f.unit}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="hs-fade" style={{
        position:'absolute', right:0, top:0, bottom:0, width:40, pointerEvents:'none',
        background:`linear-gradient(to right, transparent, ${C.bg})`,
        display:'flex', alignItems:'center', justifyContent:'flex-end', paddingRight:6,
        opacity:0, transition:'opacity 0.12s ease', zIndex:1,
      }}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted}
          strokeWidth="2.5" strokeLinecap="round" opacity="0.5">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </div>
      </div>}


      {/* ── Trend panel — always rendered at fixed height to prevent layout shift ── */}
      {!collapsed && (() => {
        const m = expandedMetric ? metrics.find(x => x.key === expandedMetric) : null;
        const trendCacheKey = expandedMetric ? `${expandedMetric}:${date}:${trendRange}` : null;
        const avgVal = m && trendCacheKey && trendData[trendCacheKey]
          ? (() => {
              const span = trendRange === "12m" ? 364 : 29;
              const anchorDate = new Date(date + 'T12:00:00');
              const days=[];for(let i=-span;i<=0;i++)days.push(toKey(shift(anchorDate,i)));
              const vals=days.map(d=>trendData[trendCacheKey][d]?.[expandedMetric]).filter(v=>v!=null);
              return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
            })()
          : null;
        return (
          <div style={{
            borderTop: expandedMetric ? `1px solid ${C.border}` : 'none',
            maxHeight: expandedMetric ? 160 : 0,
            overflow: 'hidden',
            opacity: expandedMetric ? 1 : 0,
            transition: 'max-height 0.25s ease, opacity 0.2s ease, border 0.2s ease',
            padding: expandedMetric ? "10px 16px 8px" : "0 16px",
          }}>
            {m && <>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
                    textTransform:"uppercase",color:m.color}}>
                    trend
                  </span>
                  {date !== todayKey() && (
                    <span style={{fontFamily:mono,fontSize:"9px",color:C.dim}}>
                      to {new Date(date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                    </span>
                  )}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  {avgVal != null && (
                    <span style={{fontFamily:mono,fontSize:"10px",color:C.dim}}>avg {avgVal}</span>
                  )}
                  {["12m","30d"].map(r => (
                    <button key={r} onClick={e=>{e.stopPropagation();setTrendRange(r);}}
                      style={{fontFamily:mono,fontSize:"10px",letterSpacing:"0.05em",
                        padding:"6px 10px",borderRadius:6,cursor:"pointer",border:"none",
                        minHeight:32,
                        background: trendRange===r ? m.color+"33" : "transparent",
                        color: trendRange===r ? m.color : C.dim,
                        transition:"background 0.15s,color 0.15s"}}>
                      {r.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <TrendLine metricKey={m.key} color={m.color}/>
            </>}
          </div>
        );
      })()}

    </Card>
  );
}

// ─── Notes ────────────────────────────────────────────────────────────────────

// Plain textarea with a transparent overlay that colorizes "# heading" lines.
// Cmd+B / Cmd+I wrap selected text in ** / *.
function Notes({date,userId,token}) {
  const {value, setValue, loaded} = useDbSave(date, 'notes', '', token, userId);

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
      <Shimmer width="80%" height={14}/>
      <Shimmer width="60%" height={14}/>
      <Shimmer width="70%" height={14}/>
    </div>
  );

  return (
    <DayLabEditor
      value={value || ''}
      onBlur={text => setValue(text, {undoLabel: 'Edit notes'})}
      onImageUpload={file => uploadImageFile(file, token)}
      placeholder="What's on your mind?"
      textColor={C.text}
      mutedColor={C.dim}
      color={C.accent}
      style={{minHeight: 80, width: '100%'}}
    />
  );
}

// Helper: insert text at textarea cursor position
function insertAtCursor(ta, text) {
  const start = ta.selectionStart;
  const end   = ta.selectionEnd;
  const val   = ta.value;
  ta.value = val.slice(0, start) + text + val.slice(end);
  ta.selectionStart = ta.selectionEnd = start + text.length;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}


// ─── RowList ─────────────────────────────────────────────────────────────────
// syncedRows: live from API, may have native kcal (Strava) or need estimation (Oura)
// AI estimates for synced rows persist to DB under type+"_kcal" key
function RowList({date,type,placeholder,promptFn,prefix,color,token,userId,syncedRows=[],showProtein=false}) {
  const mkRow = () => ({id:Date.now(), text:"", kcal:null, protein:null});
  const {value:rows, setValue:setRows, loaded} = useDbSave(date, type, [mkRow()], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estimatesLoaded} = useDbSave(date, type+"_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const failed = useRef(new Set());
  const refs = useRef({});
  const [tick, setTick] = useState(0);

  const safe = (Array.isArray(rows) && rows.length ? rows : [mkRow()]).map(r => r.estimating ? {...r, estimating:false} : r);
  const estMap = (estimatesLoaded && savedEstimates && typeof savedEstimates === "object") ? savedEstimates : {};

  // Merge saved AI estimates into synced rows
  const merged = syncedRows.map(r => {
    const saved = estMap[r.id];
    const kcal = r.kcal || (typeof saved === "object" ? saved?.kcal : saved) || null;
    const protein = r.protein || (typeof saved === "object" ? saved?.protein : null) || null;
    return {...r, kcal, protein};
  });
  const totalKcal = [...safe, ...merged].reduce((s,r) => s + (r.kcal||0), 0);
  const totalProtein = showProtein ? [...safe, ...merged].reduce((s,r) => s + (r.protein||0), 0) : 0;

  // Estimate for manual rows with no kcal (e.g. added via voice/chat, no blur fired)
  useEffect(() => {
    if (!token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && !r.kcal && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setRows(prev => (Array.isArray(prev)?prev:safe).map(r =>
            r.id===row.id ? {...r, kcal:result.kcal||null, protein:result.protein||null} : r));
          else failed.current.add(row.id);
        });
      });
  }, [safe.map(r=>r.id+r.text).join(","), loaded, token]); // eslint-disable-line

  // Estimate for synced rows with no native calories
  useEffect(() => {
    if (!token || !loaded || !estimatesLoaded) return;
    merged
      .filter(r => !r.kcal && r.text && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setSavedEstimates(prev => ({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
          else failed.current.add(row.id);
        });
      });
  }, [syncedRows, loaded, estimatesLoaded, token]); // eslint-disable-line

  // Auto-fill missing protein for rows that already have kcal but no protein
  useEffect(() => {
    if (!showProtein || !token || !loaded) return;
    safe
      .filter(r => r.text?.trim() && r.kcal && !r.protein && !estimating.current.has(r.id) && !failed.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result?.protein) {
            setRows(prev => (Array.isArray(prev)?prev:safe).map(r =>
              r.id===row.id ? {...r, protein:result.protein, kcal:result.kcal||r.kcal} : r));
          } else failed.current.add(row.id);
        });
      });
  }, [loaded, token, showProtein]); // eslint-disable-line

  async function runEstimate(id, text) {
    setRows(safe.map(r => r.id===id ? {...r, estimating:true} : r));
    try {
      const result = await estimateNutrition(promptFn(text), token);
      setRows(prev => (Array.isArray(prev)?prev:safe).map(r => r.id===id ? {...r, kcal:result?.kcal||null, protein:result?.protein||null, estimating:false} : r));
    } catch(_) {
      setRows(prev => (Array.isArray(prev)?prev:safe).map(r => r.id===id ? {...r, estimating:false} : r));
    }
  }

  function onKey(e, id, idx) {
    if (e.key==="Enter") {
      e.preventDefault();
      const row = mkRow();
      const i = safe.findIndex(r => r.id===id);
      setRows([...safe.slice(0,i+1), row, ...safe.slice(i+1)]);
      setTimeout(() => refs.current[row.id]?.focus(), 30);
    }
    if (e.key==="Backspace" && safe[idx]?.text==="" && safe.length>1) {
      e.preventDefault();
      setRows(safe.filter(r => r.id!==id));
      const t = safe[idx-1]?.id ?? safe[idx+1]?.id;
      setTimeout(() => refs.current[t]?.focus(), 30);
    }
    if (e.key==="ArrowUp" && idx > 0) { e.preventDefault(); refs.current[safe[idx-1].id]?.focus(); }
    if (e.key==="ArrowDown" && idx < safe.length-1) { e.preventDefault(); refs.current[safe[idx+1].id]?.focus(); }
  }

  if (!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );

  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0,
    borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};
  const PROT_W = 50, ENRG_W = 72;
  const colProtein = {fontFamily:mono, fontSize:F.sm, color:C.blue, flexShrink:0,
    width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal = {fontFamily:mono, fontSize:F.sm, color:C.orange, flexShrink:0,
    width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMutedProt = {fontFamily:mono, fontSize:F.sm, color:C.muted, flexShrink:0,
    width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMutedEnrg = {fontFamily:mono, fontSize:F.sm, color:C.muted, flexShrink:0,
    width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const rowStyle = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};
  const hdrColProt = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em", textTransform:"uppercase",
    color:C.muted, flexShrink:0, textAlign:"center", width:PROT_W};
  const hdrColEnrg = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.06em", textTransform:"uppercase",
    color:C.muted, flexShrink:0, textAlign:"center", width:ENRG_W};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {merged.map(row => (
          <div key={row.id} style={rowStyle}>
            <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,
              overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1,minWidth:0}}>
              {row.text}
            </span>
            <SourceBadge source={row.source}/>
            {showProtein && (
              <span style={row.protein ? colProtein : colMutedProt}>
                {estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : colMutedEnrg}>
              {estimating.current.has(row.id) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
        {safe.map((row, idx) => (
          <div key={row.id} style={rowStyle}>
            <input ref={el=>refs.current[row.id]=el} value={row.text}
              onChange={e => setRows(safe.map(r => r.id===row.id ? {...r,text:e.target.value,kcal:null,protein:null} : r))}
              onBlur={e => { const r=safe.find(r=>r.id===row.id); if(e.target.value.trim()&&r?.kcal===null&&!r?.estimating) runEstimate(row.id,e.target.value); }}
              onKeyDown={e => onKey(e,row.id,idx)}
              placeholder={idx===0 && merged.length===0 ? placeholder : idx===0 ? "+" : ""}
              style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,
                lineHeight:1.7,color:row.text?C.text:C.muted,fontFamily:serif,fontSize:F.md}}/>
            {showProtein && (
              <span style={row.protein ? colProtein : colMutedProt}>
                {!row.text ? "" : row.estimating ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : colMutedEnrg}>
              {!row.text ? "" : row.estimating ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:0,borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          {showProtein && (
            <div style={{width:PROT_W,display:"flex",justifyContent:"center"}}>
              {totalProtein > 0 && <span style={{...chipBase,background:C.blue+"22",color:C.blue}}>{totalProtein}g</span>}
            </div>
          )}
          <div style={{width:ENRG_W,display:"flex",justifyContent:"center"}}>
            {totalKcal > 0 && <span style={{...chipBase,background:C.orange+"22",color:C.orange}}>{totalKcal}kcal</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function Meals({date,token,userId}){return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Estimate for: "${t}". Return JSON: {"kcal":420,"protein":30}`} prefix="" color={C.accent} showProtein/>;}
function SourceBadge({source}) {
  if (!source) return null;
  const isStrava = source === "strava";
  return (
    <span style={{
      fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", textTransform:"uppercase",
      color: isStrava ? "#FC4C02" : "#B8A882",
      border: `1px solid ${isStrava ? "#FC4C02" : "#B8A882"}`,
      borderRadius:3, padding:"1px 4px", flexShrink:0, opacity:0.8,
    }}>{isStrava ? "Strava" : "Oura"}</span>
  );
}

// Merge Oura workouts + Strava activities, deduplicating by overlapping type+time
function normalizeType(str) {
  return (str||"").toLowerCase().replace(/[^a-z]/g,"");
}
function mergeWorkouts(ouraWorkouts, stravaActivities) {
  const merged = [];

  // Start with Strava (higher quality names + data)
  for (const act of stravaActivities) {
    merged.push({ source:"strava", name:act.name, sport:act.sport||act.type,
      durationMins:act.duration?Math.round(act.duration/60):null,
      distance:act.distance, calories:act.calories,
      avgHr:act.avgHr, avgSpeed:act.avgSpeed, startTime:act.startTime, id:act.id });
  }

  // Add Oura workouts not already covered by a Strava entry
  for (const w of ouraWorkouts) {
    const wType = normalizeType(w.activity);
    const isDupe = merged.some(m => {
      if(normalizeType(m.sport)===wType || normalizeType(m.name).includes(wType)) {
        return Math.abs((m.durationMins||0)-(w.durationMins||0)) <= 5;
      }
      return false;
    });
    if (!isDupe) {
      merged.push({ source:"oura", name:w.activity||"Workout",
        sport:w.activity, durationMins:w.durationMins,
        distance:w.distance, calories:w.calories,
        startTime:w.startTime });
    }
  }
  return merged;
}

function calcPace(w) {
  const mps = w.avgSpeed || (w.durationMins && w.distance ? (w.distance*1000)/(w.durationMins*60) : null);
  if (!mps) return null;
  const secsPerMile = 1609.34 / mps;
  const m = Math.floor(secsPerMile/60);
  const s = Math.round(secsPerMile%60);
  return `${m}:${String(s).padStart(2,"0")}`;
}
function isRun(w) { return (w.sport||w.type||w.name||"").toLowerCase().match(/run|jog/); }

function Activity({date,token,userId,stravaConnected}) {
  const [syncedRows, setSyncedRows] = useState([]);
  const mkRow = () => ({id:Date.now(), text:"", dist:null, pace:null, kcal:null});
  const {value:manualRows, setValue:setManualRows, loaded} = useDbSave(date, "activity", [mkRow()], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estLoaded} = useDbSave(date, "activity_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const failed = useRef(new Set());
  const [tick, setTick] = useState(0);
  const safe = (Array.isArray(manualRows)&&manualRows.length ? manualRows : [mkRow()]).map(r => r.estimating ? {...r, estimating:false} : r);
  const refs = useRef({});
  const estMap = (estLoaded && savedEstimates && typeof savedEstimates==="object") ? savedEstimates : {};

  // Merge saved kcal estimates into synced rows
  const mergedSynced = syncedRows.map(r => ({
    ...r,
    kcal: r.kcal || (typeof estMap[r.id]==="object" ? estMap[r.id]?.kcal : estMap[r.id]) || null,
  }));

  useEffect(()=>{
    if(!token||!userId)return;
    setSyncedRows([]);
    Promise.all([
      cachedOuraFetch(date, token, userId),
      fetch(`/api/strava?date=${date}`,{headers:{Authorization:`Bearer ${token}`}}).then(r=>r.json()).catch(()=>({})),
    ]).then(([ouraData, stravaData])=>{
      const merged = mergeWorkouts(ouraData.workouts||[], stravaData.activities||[]);
      const rows = merged.map(w=>({
        id: String(w.id || `${w.source}-${w.sport}-${w.durationMins}`),
        source: w.source,
        text: w.name,
        dist: w.distance ? `${(w.distance*0.621371).toFixed(2)}mi` : null,
        pace: isRun(w) ? calcPace(w) : null,
        kcal: w.calories||null,
      }));
      setSyncedRows(rows);
      if (rows.length && token) {
        // Save normalized display rows (same schema as manual activity rows) for history view
        const summary = rows.map(r=>({
          id:r.id, text:r.text, source:r.source,
          dist:r.dist||null, pace:r.pace||null, kcal:r.kcal||null,
        }));
        fetch('/api/entries',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
          body:JSON.stringify({date,type:'workouts',data:summary})}).catch(()=>{});
      }
    });
  },[date,token,userId,stravaConnected]); // eslint-disable-line

  // AI kcal estimation for manual rows with no kcal (e.g. added via voice/chat)
  useEffect(()=>{
    if(!token||!loaded)return;
    safe.filter(r=>r.text?.trim()&&!r.kcal&&!estimating.current.has(r.id)&&!failed.current.has(r.id)).forEach(row=>{
      estimating.current.add(row.id);
      estimateNutrition(`Calories burned for: "${row.text}" for a typical adult. Return JSON: {"kcal":300}`, token).then(result=>{
        estimating.current.delete(row.id);
        if(result?.kcal) setManualRows(prev=>(Array.isArray(prev)?prev:safe).map(r=>r.id===row.id?{...r,kcal:result.kcal||null}:r));
        else failed.current.add(row.id);
      });
    });
  },[safe.map(r=>r.id+r.text).join(","),loaded,token]); // eslint-disable-line

  // AI kcal estimation for synced rows without native calories
  useEffect(()=>{
    if(!token||!loaded||!estLoaded)return;
    mergedSynced.filter(r=>!r.kcal&&r.text&&!estimating.current.has(r.id)&&!failed.current.has(r.id)).forEach(row=>{
      estimating.current.add(row.id);
      estimateNutrition(`Calories burned for: "${row.text}"${row.dist?` (${row.dist})`:""} for a typical adult. Return JSON: {"kcal":300}`, token).then(result=>{
        estimating.current.delete(row.id);
        if(result?.kcal) setSavedEstimates(prev=>({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
        else failed.current.add(row.id);
      });
    });
  },[syncedRows,loaded,estLoaded,token]); // eslint-disable-line

  function parseActivityText(text) {
    const t = text.toLowerCase();
    // Distance: "5 mi", "5.2mi", "5 miles", "8 km", "8km"
    const distMi = t.match(/(\d+\.?\d*)\s*mi(?:les?)?/);
    const distKm  = t.match(/(\d+\.?\d*)\s*km/);
    let dist = null;
    if (distMi) dist = `${parseFloat(distMi[1]).toFixed(2)}mi`;
    else if (distKm) dist = `${(parseFloat(distKm[1])*0.621371).toFixed(2)}mi`;
    // Pace: "8 min pace", "8:30 pace", "8:30/mi", "7 min/mi"
    const paceColon = t.match(/(\d+):(\d{2})\s*(?:\/mi|pace|per)/);
    const paceMin   = t.match(/(\d+\.?\d*)\s*min(?:ute)?\s*(?:\/mi|pace|per)/);
    let pace = null;
    if (paceColon) pace = `${paceColon[1]}:${paceColon[2]}`;
    else if (paceMin) { const tot=parseFloat(paceMin[1])*60; pace=`${Math.floor(tot/60)}:${String(Math.round(tot%60)).padStart(2,'0')}`; }
    return { dist, pace };
  }
  function onKey(e,id,idx) {
    if(e.key==="Enter"){
      e.preventDefault();
      // Parse and save dist/pace for current row before moving on
      const cur=safe.find(r=>r.id===id);
      if(cur?.text){
        const {dist,pace}=parseActivityText(cur.text);
        const updated=safe.map(r=>r.id===id?{...r,dist:dist||r.dist,pace:pace||r.pace}:r);
        const newRow=mkRow();
        const i=updated.findIndex(r=>r.id===id);
        setManualRows([...updated.slice(0,i+1),newRow,...updated.slice(i+1)]);
        if(cur.kcal===null&&!cur.estimating) runEstimate(id,cur.text);
        setTimeout(()=>refs.current[newRow.id]?.focus(),30);
      } else {
        const row=mkRow();const i=safe.findIndex(r=>r.id===id);
        setManualRows([...safe.slice(0,i+1),row,...safe.slice(i+1)]);
        setTimeout(()=>refs.current[row.id]?.focus(),30);
      }
    }
    if(e.key==="Backspace"&&safe[idx]?.text===""&&safe.length>1){e.preventDefault();setManualRows(safe.filter(r=>r.id!==id));const t=safe[idx-1]?.id??safe[idx+1]?.id;setTimeout(()=>refs.current[t]?.focus(),30);}
    if(e.key==="ArrowUp"&&idx>0){e.preventDefault();refs.current[safe[idx-1].id]?.focus();}
    if(e.key==="ArrowDown"&&idx<safe.length-1){e.preventDefault();refs.current[safe[idx+1].id]?.focus();}
  }

  async function runEstimate(id, text) {
    setManualRows(safe.map(r=>r.id===id?{...r,estimating:true}:r));
    const result = await estimateNutrition(`Calories burned for: "${text}" for a typical adult. Return JSON: {"kcal":300}`, token);
    setManualRows(prev=>(Array.isArray(prev)?prev:safe).map(r=>r.id===id?{...r,kcal:result?.kcal||null,estimating:false}:r));
  }

  const KCOL=72, DCOL=60, PCOL=100;
  const colDist  = {fontFamily:mono, fontSize:F.sm, color:C.blue,   flexShrink:0, width:DCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colPace  = {fontFamily:mono, fontSize:F.sm, color:C.green,  flexShrink:0, width:PCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal  = {fontFamily:mono, fontSize:F.sm, color:C.orange, flexShrink:0, width:KCOL, textAlign:"center", whiteSpace:"nowrap"};
  const colMuted = (w) => ({fontFamily:mono, fontSize:F.sm, color:C.muted, flexShrink:0, width:w, textAlign:"center", whiteSpace:"nowrap"});
  const editCol  = (w, clr) => ({fontFamily:mono, fontSize:F.sm, color:clr, flexShrink:0, width:w, textAlign:"center",
    background:"transparent", border:"none", outline:"none", padding:0});
  const rowS = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};
  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0, borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};

  const allRows = [...mergedSynced, ...safe];
  const totalKcal = allRows.reduce((s,r)=>s+(r.kcal||0),0);

  // Parse distances like "3.50mi" → number
  function parseDist(d){ const m=String(d||"").match(/[\d.]+/); return m?+m[0]:null; }
  function parsePaceSecs(p){ const m=String(p||"").match(/^(\d+):(\d+)/); return m?+m[1]*60+ +m[2]:null; }
  const distVals = allRows.map(r=>parseDist(r.dist)).filter(Boolean);
  const paceVals = allRows.map(r=>parsePaceSecs(r.pace)).filter(Boolean);
  const totalDistMi = distVals.length ? distVals.reduce((a,b)=>a+b,0) : 0;
  const avgPaceSecs = paceVals.length ? paceVals.reduce((a,b)=>a+b,0)/paceVals.length : 0;
  const avgPaceFmt = avgPaceSecs ? `${Math.floor(avgPaceSecs/60)}:${String(Math.round(avgPaceSecs%60)).padStart(2,"0")}` : null;
  const showTotals = totalKcal>0||totalDistMi>0||avgPaceFmt;

  if(!loaded) return (<div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
    <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/>
  </div>);

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {mergedSynced.map(row=>(
          <div key={row.id} style={rowS}>
            <span style={{display:"flex",alignItems:"center",gap:6,flex:1,minWidth:0,overflow:"hidden"}}>
              <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,
                overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {row.text}
              </span>
              <SourceBadge source={row.source}/>
            </span>
            <span style={row.dist ? colDist : colMuted(DCOL)}>{row.dist||""}</span>
            <span style={row.pace ? colPace : colMuted(PCOL)}>{row.pace?`${row.pace}/mi`:""}</span>
            <span style={row.kcal ? colKcal : colMuted(KCOL)}>
              {estimating.current.has(row.id)?"…":row.kcal?`-${row.kcal}kcal`:""}
            </span>
          </div>
        ))}
        {safe.map((row,idx)=>(
          <div key={row.id} style={rowS}>
            <input ref={el=>refs.current[row.id]=el} value={row.text}
              onChange={e=>setManualRows(safe.map(r=>r.id===row.id?{...r,text:e.target.value,kcal:null}:r))}
              onBlur={e=>{
                const r=safe.find(r=>r.id===row.id);
                const text=e.target.value.trim();
                if(text){
                  const {dist,pace}=parseActivityText(text);
                  setManualRows(prev=>(Array.isArray(prev)?prev:safe).map(x=>x.id===row.id?{...x,dist:dist||x.dist,pace:pace||x.pace}:x));
                  if(r?.kcal===null&&!r?.estimating) runEstimate(row.id,text);
                }
              }}
              onKeyDown={e=>onKey(e,row.id,idx)}
              placeholder={idx===0&&mergedSynced.length===0?"What did you do?":""}
              style={{background:"transparent",border:"none",outline:"none",padding:0,flex:1,
                lineHeight:1.7,color:row.text?C.text:C.muted,fontFamily:serif,fontSize:F.md}}/>
            <span style={row.dist ? colDist : colMuted(DCOL)}>{!row.text ? "" : row.dist||"—"}</span>
            <span style={row.pace ? colPace : colMuted(PCOL)}>{!row.text ? "" : row.pace?`${row.pace}/mi`:"—"}</span>
            <span style={row.kcal ? colKcal : colMuted(KCOL)}>
              {!row.text ? "" : row.estimating?"…":row.kcal?`-${row.kcal}kcal`:"—"}
            </span>
          </div>
        ))}
      </div>
      {showTotals && (
        <div style={{flexShrink:0,paddingTop:6,paddingBottom:2,display:"flex",alignItems:"center",borderTop:`1px solid ${C.border}`}}>
          <div style={{flex:1}}/>
          <div style={{width:DCOL,display:"flex",justifyContent:"center"}}>
            {totalDistMi>0&&<span style={{...chipBase,background:C.blue+"22",color:C.blue}}>{totalDistMi.toFixed(1)}mi</span>}
          </div>
          <div style={{width:PCOL,display:"flex",justifyContent:"center"}}>
            {avgPaceFmt&&<span style={{...chipBase,background:C.green+"22",color:C.green}}>{avgPaceFmt}/mi</span>}
          </div>
          <div style={{width:KCOL,display:"flex",justifyContent:"center"}}>
            {totalKcal>0&&<span style={{...chipBase,background:C.orange+"22",color:C.orange}}>-{totalKcal}kcal</span>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tasks ────────────────────────────────────────────────────────────────────
// ─── NewProjectTask — empty-state inline task input for project view ─────────
function NewProjectTask({ project, onAdd }) {
  const [text, setText] = useState('');
  const inputRef = useRef(null);
  const col = projectColor(project);

  function commit() {
    if (text.trim()) { onAdd(text); setText(''); }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
      {/* Checkbox placeholder */}
      <div style={{
        width: 14, height: 14, flexShrink: 0,
        borderRadius: 3, border: `1.5px solid ${C.border2}`,
        background: 'transparent',
      }}/>
      <input
        ref={inputRef}
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
        }}
        onBlur={commit}
        placeholder={`Add a task…`}
        style={{
          flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontFamily: serif, fontSize: F.md, color: C.text,
          caretColor: col,
        }}
      />
    </div>
  );
}

// ─── TaskFilterBtns ──────────────────────────────────────────────────────────
function TaskFilterBtns({ filter, setFilter }) {
  const OpenIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2.5"/>
    </svg>
  );
  const DoneIcon = () => (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="12" height="12" rx="2.5"/>
      <polyline points="5,8.5 7,10.5 11,6"/>
    </svg>
  );
  const btns = [
    { key: 'open', label: null,  icon: <OpenIcon/> },
    { key: 'done', label: null,  icon: <DoneIcon/> },
    { key: 'all',  label: 'ALL', icon: null },
  ];
  return (
    <div style={{ display:'flex', gap:4 }}>
      {btns.map(b => {
        const active = filter === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setFilter(b.key); }}
            style={{
              fontFamily: mono, fontSize: '10px', letterSpacing: '0.06em',
              padding: b.label ? '3px 8px' : '3px 6px',
              borderRadius: 4, cursor: 'pointer',
              minHeight: 22,
              background: active ? C.accent+'22' : 'none',
              border: `1px solid ${active ? C.accent : C.border2}`,
              color: active ? C.accent : C.muted,
              display: 'flex', alignItems: 'center', gap: 3,
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor=C.accent+'66'; e.currentTarget.style.color=C.text; }}}
            onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor=C.border2; e.currentTarget.style.color=C.muted; }}}
          >
            {b.label || b.icon}
          </button>
        );
      })}
    </div>
  );
}

function Tasks({date,token,userId,taskFilter='all'}) {
  const mkRow=()=>({id:Date.now(),text:"",done:false});
  const {value:rows,setValue:setRows,loaded}=useDbSave(date,"tasks",[mkRow()],token,userId);
  const skipBlurRef=useRef(false);
  const longPressTimer=useRef(null);
  const clickCaretRef=useRef(null);
  const [focusedId, setFocusedId] = useState(null);
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState(new Set());
  const safe=Array.isArray(rows)&&rows.length?rows:[mkRow()];
  const open=safe.filter(r=>!r.done),done=safe.filter(r=>r.done);
  const visible = taskFilter==='open' ? open : taskFilter==='done' ? done : safe;

  function enterSelMode(id) { setSelMode(true); setSelIds(new Set([id])); setFocusedId(null); }
  function exitSelMode() { setSelMode(false); setSelIds(new Set()); }
  function toggleSel(id) {
    setSelIds(prev => {
      const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id);
      if (n.size===0) setSelMode(false);
      return n;
    });
  }
  function bulkDone(val) {
    setRows(prev=>(Array.isArray(prev)?prev:[]).map(r=>selIds.has(r.id)?{...r,done:val}:r));
    exitSelMode();
  }
  function bulkDelete() {
    setRows(prev=>(Array.isArray(prev)?prev:[]).filter(r=>!selIds.has(r.id)));
    exitSelMode();
  }

  if(!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/><Shimmer width="55%" height={13}/><Shimmer width="65%" height={13}/>
    </div>
  );

  return (
    <div style={{flex:1,overflow:"auto"}}>
      {selMode&&(
        <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 2px 8px',
          borderBottom:`1px solid ${C.border}`,marginBottom:6}}>
          <span style={{fontFamily:mono,fontSize:10,color:C.muted,flex:1}}>{selIds.size} selected</span>
          <button onClick={()=>bulkDone(true)} style={{fontFamily:mono,fontSize:9,letterSpacing:'0.05em',
            padding:'3px 8px',borderRadius:4,cursor:'pointer',
            background:C.accent+'22',border:`1px solid ${C.accent}40`,color:C.accent}}>Done</button>
          <button onClick={()=>bulkDone(false)} style={{fontFamily:mono,fontSize:9,letterSpacing:'0.05em',
            padding:'3px 8px',borderRadius:4,cursor:'pointer',
            background:'none',border:`1px solid ${C.border2}`,color:C.muted}}>Reopen</button>
          <button onClick={bulkDelete} style={{fontFamily:mono,fontSize:9,letterSpacing:'0.05em',
            padding:'3px 8px',borderRadius:4,cursor:'pointer',
            background:C.red+'22',border:`1px solid ${C.red}40`,color:C.red}}>Delete</button>
          <button onClick={exitSelMode} style={{fontFamily:mono,fontSize:11,padding:'2px 6px',
            borderRadius:4,cursor:'pointer',background:'none',border:`1px solid ${C.border2}`,color:C.muted,lineHeight:1}}>✕</button>
        </div>
      )}

      {visible.map((row,idx)=>{
        const isSel=selIds.has(row.id);
        const isEditing=focusedId===row.id&&!selMode;
        return (
          <div key={row.id} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"4px 0",minHeight:28,
            opacity:row.done&&!selMode?0.35:1,transition:"opacity 0.2s",
            background:isSel?C.accent+'15':'transparent',borderRadius:isSel?6:0}}>

            {/* Checkbox / selection bubble */}
            {selMode?(
              <div onClick={()=>toggleSel(row.id)}
                style={{width:15,height:15,flexShrink:0,borderRadius:4,marginTop:5,cursor:'pointer',
                  border:`1.5px solid ${isSel?C.accent:C.border2}`,background:isSel?C.accent:'transparent',
                  display:'flex',alignItems:'center',justifyContent:'center',transition:'all 0.15s'}}>
                {isSel&&<span style={{fontSize:10,color:C.bg,lineHeight:1}}>✓</span>}
              </div>
            ):(
              <button onClick={()=>{
                  const wasDone=row.done;
                  setRows(safe.map(r=>r.id===row.id?{...r,done:!r.done}:r));
                  pushHistory({
                    label:wasDone?`Uncomplete "${row.text}"`:` Complete "${row.text}"`,
                    undo:()=>setRows(safe.map(r=>r.id===row.id?{...r,done:wasDone}:r)),
                    redo:()=>setRows(safe.map(r=>r.id===row.id?{...r,done:!wasDone}:r)),
                  });
                }}
                style={{width:15,height:15,flexShrink:0,borderRadius:4,padding:0,cursor:"pointer",marginTop:5,
                  border:`1.5px solid ${row.done?C.accent:C.border2}`,background:row.done?C.accent:"transparent",
                  display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                {row.done&&<span style={{fontSize:12,color:C.bg,lineHeight:1}}>✓</span>}
              </button>
            )}

            {/* Text area — key changes edit↔view so React always creates a fresh DOM node,
                preventing reconciliation from merging our manually-set innerHTML with
                React-rendered children (which caused the doubling bug) */}
            <div style={{flex:1,minWidth:0,minHeight:'1.7em',lineHeight:1.7}}
              onTouchStart={selMode?undefined:()=>{
                longPressTimer.current=setTimeout(()=>{longPressTimer.current=null;enterSelMode(row.id);},500);
              }}
              onTouchMove={()=>{clearTimeout(longPressTimer.current);longPressTimer.current=null;}}
              onTouchEnd={()=>{clearTimeout(longPressTimer.current);longPressTimer.current=null;}}
            >
              {selMode?(
                <div key={`s${row.id}`} onClick={()=>toggleSel(row.id)}
                  style={{fontFamily:serif,fontSize:F.md,lineHeight:1.7,color:row.done?C.muted:C.text,
                    textDecoration:row.done?'line-through':'none',whiteSpace:'pre-wrap',wordBreak:'break-word',
                    cursor:'pointer',minHeight:'1.7em',userSelect:'none'}}>
                  {row.text?renderWithTags(row.text):null}
                </div>
              ):isEditing?(
                /* EDIT MODE — TipTap DayLabEditor */
                <DayLabEditor
                  key={`e${row.id}`}
                  value={row.text}
                  autoFocus
                  singleLine
                  textColor={row.done ? C.muted : C.text}
                  mutedColor={C.dim}
                  color={row.done ? C.muted : C.accent}
                  onBlur={text => {
                    if (skipBlurRef.current) { skipBlurRef.current = false; return; }
                    setRows(prev => (Array.isArray(prev) ? prev : []).map(r => r.id === row.id ? {...r, text} : r));
                    setTimeout(() => setFocusedId(prev => prev === row.id ? null : prev), 0);
                  }}
                  onEnterSplit={({before, after}) => {
                    skipBlurRef.current = true;
                    const newRow = {id: crypto.randomUUID(), text: after, done: false};
                    setRows(prev => {
                      const ps = Array.isArray(prev) && prev.length ? prev : [mkRow()];
                      const nr = ps.map(r => r.id === row.id ? {...r, text: before} : r);
                      nr.splice(idx + 1, 0, newRow);
                      return nr;
                    });
                    setFocusedId(newRow.id);
                  }}
                  onBackspaceEmpty={idx > 0 ? () => {
                    // Merge this row's text onto the end of the previous row, delete this row
                    skipBlurRef.current = true;
                    const thisText = row.text || '';
                    setRows(prev => {
                      const ps = Array.isArray(prev) && prev.length ? prev : [mkRow()];
                      const prevRow = ps[idx - 1];
                      if (!prevRow) return ps;
                      const merged = (prevRow.text || '') + thisText;
                      return ps
                        .map(r => r.id === prevRow.id ? {...r, text: merged} : r)
                        .filter(r => r.id !== row.id);
                    });
                    setFocusedId(visible[idx - 1]?.id ?? null);
                  } : undefined}
                  style={{
                    minHeight: '1.7em', width: '100%',
                    textDecoration: row.done ? 'line-through' : 'none',
                    opacity: row.done ? 0.5 : 1,
                  }}
                  placeholder={idx === 0 && visible.length === 1 && !row.text && taskFilter !== 'done' ? 'Add a task…' : ''}
                />
              ):(
                /* VIEW MODE */
                <div key={`v${row.id}`}
                  onPointerDown={e=>{
                    e._taskDownX=e.clientX;e._taskDownY=e.clientY;
                    try {
                      let range=null;
                      if(document.caretRangeFromPoint) range=document.caretRangeFromPoint(e.clientX,e.clientY);
                      else if(document.caretPositionFromPoint){const cp=document.caretPositionFromPoint(e.clientX,e.clientY);if(cp){range=document.createRange();range.setStart(cp.offsetNode,cp.offset);}}
                      if(range){
                        let pos=0,found=false;
                        function walkNodes(node){if(found)return;if(node.nodeType===Node.TEXT_NODE){if(node===range.startContainer){pos+=range.startOffset;found=true;return;}pos+=node.textContent.length;}else{for(const c of node.childNodes)walkNodes(c);}}
                        walkNodes(e.currentTarget);
                        clickCaretRef.current=found?pos:null;
                      }
                    }catch(_){clickCaretRef.current=null;}
                  }}
                  onPointerUp={e=>{
                    const dx=e.clientX-(e._taskDownX??e.clientX),dy=e.clientY-(e._taskDownY??e.clientY);
                    if(Math.sqrt(dx*dx+dy*dy)<5)setFocusedId(row.id);
                  }}
                  onContextMenu={e=>{e.preventDefault();enterSelMode(row.id);}}
                  style={{fontFamily:serif,fontSize:F.md,lineHeight:1.7,
                    color:row.done?C.muted:C.text,textDecoration:row.done?'line-through':'none',
                    whiteSpace:'pre-wrap',wordBreak:'break-word',
                    cursor:'text',minHeight:'1.7em',userSelect:'text'}}>
                  {row.text
                    ?renderWithTags(row.text)
                    :(idx===0&&open.length===1&&taskFilter!=='done'?<span style={{color:C.dim}}>Add a task…</span>:null)
                  }
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginScreen() {
  const [loading,setLoading]=useState(false);
  return (
    <div style={{background:C.bg,minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",position:"relative"}}>
      <div style={{textAlign:"center"}}>
        <div style={{
          display:"inline-block",
          fontFamily:serif,fontSize:F.lg,letterSpacing:"-0.02em",
          color:C.text,marginBottom:24,
        }}>Day Lab</div>
        <div style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:48}}>your ai dashboard</div>
        <button disabled={loading} onClick={async()=>{
          setLoading(true);
          const supabase=createClient();
          const isNative = !!(window.daylabNative);
          const redirectTo = isNative ? `daylab://auth/callback` : `${window.location.origin}/auth/callback`;
          await supabase.auth.signInWithOAuth({provider:"google",options:{
            scopes:"https://www.googleapis.com/auth/calendar",
            redirectTo,
            queryParams:{access_type:"offline",prompt:"consent"},
          }});
        }} style={{background:"none",border:`1px solid ${C.border2}`,borderRadius:8,
          color:loading?C.muted:C.text,fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",
          textTransform:"uppercase",padding:"13px 32px",cursor:loading?"not-allowed":"pointer"}}>
          {loading?"redirecting…":"sign in with google"}
        </button>

      </div>
      <div style={{position:"absolute",bottom:24,left:0,right:0,display:"flex",justifyContent:"center",gap:24}}>
        <a href="/privacy" style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Privacy</a>
        <a href="/terms" style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.04em",textTransform:"uppercase",color:C.muted,textDecoration:"none",opacity:0.6}}>Terms</a>
      </div>
    </div>
  );
}

// ─── InsightsCard ─────────────────────────────────────────────────────────────
function InsightsCard({date, token, userId, healthKey, collapsed, onToggle}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [freeUsage, setFreeUsage] = useState(null); // { count, limit }
  const prevDate = useRef(date);
  const generatedWithKey = useRef(null); // healthKey used for last generation, null = not yet
  const waitTimer = useRef(null);

  const BAD_VALUES = ["No data available", "No insights generated", "AI error"];

  function cleanInsight(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^[A-Za-z]+,\s+\w+ \d+\n+/, '')
      .trim();
  }

  function isBadCache(t, cached, currentHealthKey) {
    if (!t) return true;
    if (BAD_VALUES.some(b => t.includes(b))) return true;
    if (cached?.isWelcome && currentHealthKey) return true;
    if (cached?.v !== 8) return true;
    // If the insight was generated with different health data than what we have now, it's stale.
    // e.g. generated with yesterday's bleeding data, or generated before Oura loaded.
    if (cached?.healthKey !== undefined && cached.healthKey !== currentHealthKey) return true;
    return false;
  }

  async function generate(currentHealthKey) {
    if (!token || !userId) return;
    if (generatedWithKey.current === currentHealthKey) return; // already generated for this exact state
    generatedWithKey.current = currentHealthKey;
    clearTimeout(waitTimer.current);
    setBusy(true); setError(""); setIsFree(false);
    try {
      const cached = await dbLoad(date, "insights", token);
      const age = cached?.generatedAt ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
      if (cached?.text && !isBadCache(cached.text, cached, currentHealthKey) && age < 12 * 60 * 60 * 1000) {
        setText(cleanInsight(cached.text)); setBusy(false); return;
      }
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, healthKey: currentHealthKey }),
      });
      const data = await res.json();
      if (data.tier === "free") { setIsFree(true); setFreeUsage({ count: data.usageCount, limit: data.limit }); }
      else if (data.insight) setText(cleanInsight(data.insight));
      else if (data.error) setError(data.error);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  // Reset on date change
  useEffect(() => {
    if (prevDate.current === date) return;
    prevDate.current = date;
    generatedWithKey.current = null;
    clearTimeout(waitTimer.current);
    setText(""); setError(""); setIsFree(false); setFreeUsage(null);
  }, [date]); // eslint-disable-line

  // Trigger generation:
  // - If real health data is present: generate immediately with that key
  // - If no health data after 3s: generate with the empty key (no-ring day / future date)
  // - If health arrives AFTER the empty-key fallback fired: regenerate with real data
  useEffect(() => {
    if (!token || !userId) return;
    const [, sleep, readiness] = (healthKey || "::").split(":");
    const hasRealData = (+sleep > 0) || (+readiness > 0);
    if (hasRealData) {
      clearTimeout(waitTimer.current);
      generate(healthKey);
    } else {
      // Only start the timer if we haven't generated yet
      if (generatedWithKey.current !== null) return;
      clearTimeout(waitTimer.current);
      waitTimer.current = setTimeout(() => generate(healthKey), 3000);
    }
    return () => clearTimeout(waitTimer.current);
  }, [date, token, userId, healthKey]); // eslint-disable-line

  return (
    <Widget label="Insights" color={C.muted} slim collapsed={collapsed} onToggle={onToggle}>
      {/* Fixed responsive height — content scrolls inside, no scrollbar visible */}
      <div style={{ height: "clamp(80px, 10vh, 120px)", overflowY: "auto", scrollbarWidth: "none" }}>
        <div style={{ opacity: busy && !text ? 0 : 1, transition: "opacity 0.3s ease" }}>
          {error && (
            <div style={{ fontFamily: mono, fontSize:F.md, color: C.red, lineHeight: 1.6 }}>{error}</div>
          )}
          {isFree ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
                You've used {freeUsage?.count ?? 10} of {freeUsage?.limit ?? 10} free AI insights.
              </div>
              <div style={{ fontFamily: mono, fontSize: 12, color: C.dim, lineHeight: 1.7, marginBottom: 14 }}>
                Upgrade to Premium for unlimited insights, voice entry, and chat with your health data.
              </div>
              <button onClick={() => window.location.href = "/upgrade"} style={{
                background: C.accent, border: "none", borderRadius: 6, padding: "8px 18px",
                cursor: "pointer", fontFamily: mono, fontSize: F.sm, color: C.bg,
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>Upgrade to Premium →</button>
            </div>
          ) : text ? (
            <div style={{ fontFamily: mono, fontSize:13, color: C.dim, lineHeight: 1.75, whiteSpace: "pre-line" }}>
              {text}
            </div>
          ) : busy ? (
            <div>
              <Shimmer width="90%" height={13} />
              <div style={{ height: 10 }} />
              <Shimmer width="72%" height={13} />
              <div style={{ height: 10 }} />
              <Shimmer width="50%" height={13} />
            </div>
          ) : null}
        </div>
      </div>
    </Widget>
  );
}

// ─── Chat / QuickAdd ──────────────────────────────────────────────────────────
// Collapsed: floating entry bar (quick commands, no history).
// Expanded: full-height panel with conversation history, Q&A + entry actions.

// ─── DayLabLoader ─────────────────────────────────────────────────────────────
function DayLabLoader({ size = 32, color = "#EFDFC3" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1500 1500" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ display: "block" }}>
      <style>{`
        @keyframes dlPulse {
          0%, 100% { opacity: 0.15; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1); }
        }
        @keyframes dlDot {
          0%, 100% { opacity: 0.2; transform: scale(0.7); }
          50% { opacity: 1; transform: scale(1.1); }
        }
        .dl-cross { animation: dlPulse 1.6s ease-in-out infinite; transform-origin: 751px 767px; }
        .dl-dot   { animation: dlDot   1.6s ease-in-out infinite 0.3s; transform-origin: 1048px 474px; }
      `}</style>
      <path className="dl-cross"
        d="M841 518C841 551 842.5 578 845.5 599C849.5 619 856.5 635 866.5 647C877.5 659 892.5 667 911.5 671C930.5 675 955 677 985 677C1015 677 1039 679.5 1057 684.5C1076 689.5 1090.5 696 1100.5 704C1110.5 712 1117 721.5 1120 732.5C1124 742.5 1126 753 1126 764C1126 775 1124.5 786.5 1121.5 798.5C1119.5 809.5 1114 819.5 1105 828.5C1096 837.5 1082.5 845 1064.5 851C1046.5 857 1022 860 991 860C961 860 936 862 916 866C897 870 882 877.5 871 888.5C860 898.5 852 913 847 932C843 950 841 973 841 1001C841 1035 838.5 1061.5 833.5 1080.5C828.5 1099.5 821.5 1113.5 812.5 1122.5C804.5 1131.5 795 1137 784 1139C773 1141 762 1142 751 1142C721 1142 698.5 1133.5 683.5 1116.5C668.5 1098.5 661 1061 661 1004C661 951 651.5 914 632.5 893C614.5 871 580 860 529 860C481 860 443 854.5 415 843.5C387 831.5 373 806 373 767C373 737 383.5 714.5 404.5 699.5C426.5 684.5 466 677 523 677C551 677 574 675 592 671C610 666 624 658 634 647C645 635 652 619 655 599C659 579 661 553 661 521C661 493 663.5 470.5 668.5 453.5C673.5 436.5 680 423.5 688 414.5C696 405.5 705.5 399.5 716.5 396.5C727.5 393.5 739 392 751 392C784 392 807 403.5 820 426.5C834 448.5 841 479 841 518Z"
        fill={color}
      />
      <path className="dl-dot"
        d="M1138 476C1138 488.667 1135.33 500.667 1130 512C1125.33 522.667 1118.67 532.333 1110 541C1102 549 1092.33 555.667 1081 561C1070.33 565.667 1059.33 568 1048 568C1036.67 568 1025.33 565.667 1014 561C1003.33 555.667 993.667 549 985 541C976.333 532.333 969.333 522.667 964 512C958.667 500.667 956 488.667 956 476C956 463.333 958.333 451.333 963 440C968.333 428.667 975 418.667 983 410C991.667 401.333 1001.33 394.667 1012 390C1023.33 384.667 1035.33 382 1048 382C1060.67 382 1072.33 384.667 1083 390C1094.33 394.667 1104 401.333 1112 410C1120 418.667 1126.33 428.667 1131 440C1135.67 451.333 1138 463.333 1138 476ZM1013 474C1013 484 1016.33 492.333 1023 499C1029.67 505.667 1038 509 1048 509C1058 509 1066.33 505.667 1073 499C1079.67 492.333 1083 484 1083 474C1083 464 1079.67 455.667 1073 449C1066.33 442.333 1058 439 1048 439C1038 439 1029.67 442.333 1023 449C1016.33 455.667 1013 464 1013 474Z"
        fill={color}
      />
    </svg>
  );
}

function ChatFloat({date, token, userId, healthKey, theme}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);


  const [messages, setMessages] = useState([]); // [{role, content, actions, summary, isInsight}]
  const [insightLoading, setInsightLoading] = useState(false);
  const generatedInsightKey = useRef(null); // "date:healthKey" — prevents double-generation
  const prevDate = useRef(date);

  const [chatQueryCount, setChatQueryCount] = useState(0);
  const [chatLimitReached, setChatLimitReached] = useState(false);
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const FREE_CHAT_LIMIT = 3;

  // Load chat query count + premium status from DB
  useEffect(() => {
    if (!token || !userId) return;
    Promise.all([
      dbLoad("global", "chat_usage", token),
      dbLoad("global", "premium", token),
    ]).then(([usage, prem]) => {
      const count = usage?.count || 0;
      setChatQueryCount(count);
      if (count >= FREE_CHAT_LIMIT) setChatLimitReached(true);
      setIsPremiumUser(prem?.active === true);
    });
  }, [token, userId]); // eslint-disable-line

  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;
  const recognizerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingCancelledRef = useRef(false);
  const inputRef = useRef(null);

  const messagesEndRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    el.scrollTop = el.scrollHeight;
  }, [input]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (expanded && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, expanded]);

  // Close panel on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded]);

  // ── Insight generation — seeded as messages[0] ──────────────────────────
  useEffect(() => {
    if (!token || !userId) return;
    // Reset on date change
    if (prevDate.current !== date) {
      prevDate.current = date;
      generatedInsightKey.current = null;
      setMessages([]);
    }
    const [, sleep, readiness] = (healthKey || "::").split(":");
    const hasRealData = (+sleep > 0) || (+readiness > 0);
    const key = `${date}:${healthKey}`;
    if (generatedInsightKey.current === key) return;

    // Wait for real data; if none after 3s, proceed with whatever we have
    const run = async () => {
      if (generatedInsightKey.current === key) return;
      generatedInsightKey.current = key;
      setInsightLoading(true);
      try {
        // Check cache first
        const cached = await dbLoad(date, "insights", token);
        const age = cached?.generatedAt ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
        const stale = !cached?.text || cached?.v !== 8 || age > 12 * 60 * 60 * 1000 ||
          (cached?.healthKey !== undefined && cached.healthKey !== healthKey);
        let text = null;
        if (!stale) {
          text = cached.text;
        } else {
          const res = await fetch("/api/insights", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ date, healthKey }),
          });
          const data = await res.json();
          if (data.insight) text = data.insight;
          else if (data.tier === "free") text = "Upgrade to Premium to unlock daily AI insights, voice entry, and chat.";
        }
        if (text) {
          const clean = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
            .replace(/^#{1,3}\s+/gm, '').replace(/^[A-Za-z]+,\s+\w+ \d+\n+/, '').trim();
          setMessages(prev => {
            // Replace existing insight (first message if isInsight) or prepend
            const withoutInsight = prev.filter(m => !m.isInsight);
            return [{ role: "assistant", content: clean, isInsight: true }, ...withoutInsight];
          });
        }
      } catch (_) {}
      setInsightLoading(false);
    };

    if (hasRealData) {
      run();
    } else {
      const t = setTimeout(run, 3000);
      return () => clearTimeout(t);
    }
  }, [date, token, userId, healthKey]); // eslint-disable-line

  function logMicError(text) {
    setMessages(prev => [...prev, { role: "assistant", content: text }]);
  }

  async function recordAndTranscribe() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingCancelledRef.current) { recordingCancelledRef.current = false; setListening(false); setTranscribing(false); return; }
        setListening(false);
        setTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const base64 = await new Promise((res) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result.split(",")[1]);
            reader.readAsDataURL(blob);
          });
          const resp = await fetch("/api/transcribe", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ audio: base64, mimeType }),
          });
          const data = await resp.json();
          if (data.text) setInput(prev => prev ? prev + " " + data.text : data.text);
          else logMicError(data.error || "Could not transcribe");
        } catch (e) { logMicError("Transcription failed"); }
        setTranscribing(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setListening(true);
    } catch (e) { logMicError("Microphone access denied"); }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }
    if (recognizerRef.current && listening) {
      recognizerRef.current.stop();
      setListening(false);
      return;
    }
    if (!SR) {
      if (window.daylabNative) { logMicError("Voice not supported in this browser"); return; }
      recordAndTranscribe();
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognizerRef.current = rec;
    let finalTranscript = "";
    rec.onstart = () => { setListening(true); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput(finalTranscript + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") { logMicError("Microphone access denied"); setListening(false); }
      else if (e.error === "network") { setListening(false); if (!window.daylabNative) recordAndTranscribe(); }
      else if (e.error !== "no-speech" && e.error !== "aborted") { logMicError(`Mic error: ${e.error}`); setListening(false); }
      else { setListening(false); }
    };
    rec.onend = () => { setListening(false); };
    rec.start();
  }

  function stopMic() {
    if (mediaRecorderRef.current?.state === "recording") {
      recordingCancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
    if (recognizerRef.current) { recognizerRef.current.stop(); }
    setListening(false);
    setTranscribing(false);
  }

  // Dispatch refresh after chat actions, with undo support
  function dispatchRefresh(refreshTypes, summary) {
    if (!refreshTypes?.length) return;
    const snapshots = {};
    refreshTypes.forEach(t => {
      const key = `${userId}:${date}:${t}`;
      if (MEM[key] !== undefined) snapshots[key] = JSON.parse(JSON.stringify(MEM[key]));
    });
    window.dispatchEvent(new CustomEvent("lifeos:refresh", { detail: { types: refreshTypes } }));
    if (Object.keys(snapshots).length > 0) {
      pushHistory({
        label: `AI: ${summary || "entry"}`,
        undo: () => {
          Object.entries(snapshots).forEach(([k, v]) => { MEM[k] = v; DIRTY[k] = true; });
          window.dispatchEvent(new CustomEvent("lifeos:snapshot-restore", { detail: { keys: Object.keys(snapshots) } }));
        },
        redo: () => {
          Object.keys(snapshots).forEach(k => { delete MEM[k]; delete DIRTY[k]; });
          window.dispatchEvent(new CustomEvent("lifeos:refresh", { detail: { types: refreshTypes } }));
        },
      });
    }
  }

  // ── Collapsed mode: quick command via voice-action ──────────────────────
  function logToChat(userText, replyText) {
    setMessages(prev => [
      ...prev,
      { role: "user", content: userText },
      { role: "assistant", content: replyText },
    ]);
  }

  async function sendQuick() {
    if (!input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    stopMic();
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/voice-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ text: userText, date, tz }),
      });
      const data = await res.json();
      if (data.ok && data.results?.length > 0) {
        dispatchRefresh(data.results.map(r => r.type), data.summary);
        logToChat(userText, data.summary || "Done");
      } else if (data.tier === "free") {
        logToChat(userText, "Voice entry requires Premium");
      } else if (data.message) {
        logToChat(userText, data.message);
      } else if (data.error) {
        logToChat(userText, data.error);
      } else {
        logToChat(userText, "Not sure what to add — try being more specific");
      }
    } catch (e) { logToChat(userText, "Something went wrong"); }
    setBusy(false);
  }

  // ── Expanded mode: conversational chat ───────────────────────────────────
  async function sendChat(override) {
    const userText = (override ?? input).trim();
    if (!userText || busy) return;
    // Free tier gate — check isPremium via response or local count
    if (chatLimitReached) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    stopMic();

    const userMsg = { role: "user", content: userText };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: null }]); // null = loading
    setBusy(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          date,
          tz,
        }),
      });
      const data = await res.json();
      if (data.error) {
        setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: `Error: ${data.error}` }));
      } else {
        const assistantMsg = { role: "assistant", content: data.reply, actions: data.actions, summary: data.summary };
        setMessages(prev => prev.slice(0, -1).concat(assistantMsg));
        if (data.refreshTypes?.length) dispatchRefresh(data.refreshTypes, data.summary);
        // Track usage for free accounts
        if (!data.isPremium && !isPremiumUser) {
          const newCount = chatQueryCount + 1;
          setChatQueryCount(newCount);
          if (newCount >= FREE_CHAT_LIMIT) setChatLimitReached(true);
          dbSave("global", "chat_usage", { count: newCount }, token);
        }
      }
    } catch (e) {
      setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: "Something went wrong. Try again." }));
    }
    setBusy(false);
  }

  function send() {
    if (expanded) sendChat();
    else sendQuick();
  }

  const hasMic = !!(window?.SpeechRecognition || window?.webkitSpeechRecognition || navigator?.mediaDevices?.getUserMedia);
  return (
    <>
      {/* ── AI chat view — sits below TopBar (zIndex 95), pill floats above at 97 ── */}
      {expanded && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 95,
          background: C.bg,
          display: "flex", flexDirection: "column",
          animation: "fadeIn 0.15s ease",
        }}>
          {/* Spacer to clear the TopBar (safe-area + 10px padding + 52px pill + 10px padding) */}
          <div style={{ flexShrink: 0, height: "calc(env(safe-area-inset-top, 0px) + 64px)" }}/>

          {/* AI header — chevron down to collapse, title, date */}
          <div style={{
            flexShrink: 0,
            padding: "16px 20px 24px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
          }}>
            {/* Chevron down — collapse */}
            <button onClick={() => setExpanded(false)} style={{
              background: "none", border: "none", cursor: "pointer",
              color: C.dim, display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8,
              transition: "color 0.15s, background 0.15s",
              marginBottom: 12,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; e.currentTarget.style.background = `${C.text}0e`; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.dim; e.currentTarget.style.background = "transparent"; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {/* DAY LAB AI + Premium badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontFamily: mono, fontSize: F.sm, letterSpacing: "0.1em", textTransform: "uppercase", color: C.dim }}>
                Day Lab AI
              </span>
              {isPremiumUser && (
                <span style={{
                  fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: C.accent, background: `${C.accent}18`, border: `1px solid ${C.accent}40`,
                  borderRadius: 4, padding: "2px 6px",
                }}>Premium</span>
              )}
            </div>

            {/* Date */}
            <span style={{ fontFamily: blurweb, fontSize: F.lg, color: theme === "light" ? "#6B5440" : "#EFDFC3", letterSpacing: "0.06em" }}>
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>

          {/* Messages scroll area */}
          <div style={{
            flex: 1, overflowY: "auto", position: "relative",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "0 10px",
            paddingBottom: "calc(52px + max(28px, env(safe-area-inset-bottom, 28px)) + 24px)",
          }}>
            {/* Free tier vignette — sticky top overlay as limit approaches */}
            {!isPremiumUser && (chatQueryCount >= FREE_CHAT_LIMIT - 1 || chatLimitReached) && (
              <div style={{
                position: "sticky", top: 0, zIndex: 10, width: "100%",
                background: `linear-gradient(to bottom, ${C.bg} 30%, ${C.bg}cc 70%, transparent 100%)`,
                padding: "14px 16px 44px", marginBottom: -32,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                pointerEvents: chatLimitReached ? "auto" : "none",
              }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: C.muted, letterSpacing: "0.08em" }}>
                  {chatLimitReached
                    ? `${FREE_CHAT_LIMIT}/${FREE_CHAT_LIMIT} FREE MESSAGES USED`
                    : `${chatQueryCount}/${FREE_CHAT_LIMIT} free messages`}
                </span>
                {chatLimitReached && (
                  <button onClick={() => window.location.href = "/upgrade"} style={{
                    background: C.accent, border: "none", borderRadius: 10,
                    padding: "9px 22px", cursor: "pointer",
                    fontFamily: mono, fontSize: 11, color: "#fff",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>Upgrade to Premium →</button>
                )}
              </div>
            )}
            <div style={{
              width: "100%", maxWidth: 720,
              display: "flex", flexDirection: "column", gap: 12, paddingTop: 8,
            }}>

              {/* Message bubbles */}
              {messages.map((msg, i) => (
                <Fragment key={i}>
                  <div style={{
                    display: "flex", flexDirection: "column",
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    gap: 4,
                  }}>
                    <div style={{
                      maxWidth: "72%",
                      padding: "10px 16px",
                      borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      background: msg.role === "user" ? C.accent : `${C.text}0e`,
                      color: msg.role === "user" ? "#fff" : C.text,
                      fontFamily: msg.role === "user" ? serif : mono,
                      fontSize: msg.role === "user" ? F.md : 13,
                      lineHeight: 1.55,
                      letterSpacing: msg.role === "user" ? 0 : "0.02em",
                    }}>
                      {msg.content === null
                        ? <DayLabLoader size={28} color={C.dim}/>
                        : msg.content}
                    </div>
                    {msg.actions?.length > 0 && msg.summary && (
                      <div style={{
                        fontSize: 11, fontFamily: mono, color: C.green,
                        background: `${C.green}15`, border: `1px solid ${C.green}30`,
                        borderRadius: 12, padding: "3px 10px", letterSpacing: "0.04em",
                      }}>✓ {msg.summary}</div>
                    )}
                  </div>

                  {/* Chips inline after insight, before any user msg */}
                  {msg.isInsight && messages.filter(m => m.role === "user").length === 0 && (
                    <div style={{
                      display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8,
                      marginTop: 16, maxWidth: 560,
                    }}>
                      {["How's my sleep this week?", "Add oatmeal for breakfast", "What tasks are left today?", "Log a 30 min run"].map(s => (
                        <button key={s} onClick={() => sendChat(s)}
                          style={{
                            background: `${C.accent}12`, border: `1px solid ${C.accent}30`,
                            borderRadius: 100, padding: "10px 20px",
                            fontFamily: mono, fontSize: F.sm, color: C.accent,
                            cursor: "pointer", letterSpacing: "0.04em",
                            whiteSpace: "nowrap",
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = `${C.accent}22`; e.currentTarget.style.borderColor = `${C.accent}55`; }}
                          onMouseLeave={e => { e.currentTarget.style.background = `${C.accent}12`; e.currentTarget.style.borderColor = `${C.accent}30`; }}
                        >{s}</button>
                      ))}
                    </div>
                  )}
                </Fragment>
              ))}

              {insightLoading && messages.length === 0 && (
                <div style={{ padding: "8px 2px" }}>
                  <DayLabLoader size={32} color={C.dim}/>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

        </div>
      )}

      {/* ── Floating pill — ALWAYS same capsule shape, fixed at bottom ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        zIndex: 97,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingLeft: 10, paddingRight: 10,
        paddingBottom: "max(16px, env(safe-area-inset-bottom, 16px))",
        pointerEvents: "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 560,
          pointerEvents: "auto",
          display: "flex", flexDirection: "row", alignItems: "center",
          backdropFilter: expanded ? "none" : "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: expanded ? "none" : "blur(20px) saturate(1.4)",
          background: expanded ? C.surface : `${C.surface}ee`,
          border: `1px solid ${C.border}`,
          borderRadius: 100,
          minHeight: 52,
          boxShadow: C.shadow,
          overflow: "hidden",
          cursor: !expanded ? "pointer" : "default",
          transition: "box-shadow 0.18s ease",
        }}
        onClick={!expanded ? () => inputRef.current?.focus() : undefined}>

          {/* ── Input row ── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%",
            padding: mobile ? "14px 10px 14px 16px" : "14px 10px 14px 18px",
            boxSizing: "border-box",
          }}>
            {/* Text input well */}
            <div style={{
              flex: 1,
              background: "transparent",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                onFocus={() => { if (!expanded) setExpanded(true); }}
                placeholder={busy ? "…" : "Ask AI anything…"}
                disabled={busy || (expanded && chatLimitReached && !isPremiumUser)}
                rows={1}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  fontFamily: serif, fontSize: F.md, color: C.text,
                  padding: "0", margin: "0", opacity: (busy || (expanded && chatLimitReached && !isPremiumUser)) ? 0.4 : 1,
                  lineHeight: 1.4, resize: "none", overflow: "hidden", maxHeight: "120px",
                  display: "block",
                }}
              />

              {/* Send or mic */}
              {input.trim() ? (
                <button onClick={send} disabled={busy} style={{
                  background: C.accent, border: "none", borderRadius: "50%",
                  width: 32, height: 32, cursor: busy ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, opacity: busy ? 0.4 : 1, transition: "opacity 0.15s",
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"/>
                    <polyline points="5 12 12 5 19 12"/>
                  </svg>
                </button>
              ) : hasMic ? (
                <button onClick={transcribing ? undefined : toggleMic} style={{
                  background: transcribing ? `${C.accent}22` : listening ? `${C.red}22` : "transparent",
                  border: "none", borderRadius: "50%",
                  width: 32, height: 32, cursor: transcribing ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "background 0.2s",
                }}>
                  {transcribing ? (
                    <div style={{ width: 10, height: 10, borderRadius: "50%", border: `1.5px solid ${C.accent}`, borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }}/>
                  ) : listening ? (
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: C.red, boxShadow: `0 0 0 3px ${C.red}30`, animation: "pulse 1.2s ease-in-out infinite" }}/>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="2" width="6" height="11" rx="3"/>
                      <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/>
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  )}


// ─── Widget definitions ───────────────────────────────────────────────────────

// ─── SearchBar ────────────────────────────────────────────────────────────────
// ─── useSearch: debounced live search across all entry types ─────────────────
function useSearch(query, token, userId) {
  const [results, setResults] = useState(null); // null=idle, []=empty, [...]=hits
  const [loading, setLoading] = useState(false);
  const debRef = useRef(null);

  useEffect(() => {
    clearTimeout(debRef.current);
    const q = query.trim();
    if (!q || q.length < 2) { setResults(null); return; }
    debRef.current = setTimeout(() => run(q), 200);
    return () => clearTimeout(debRef.current);
  }, [query, token, userId]); // eslint-disable-line

  async function run(q) {
    if (!token || !userId) return;
    setLoading(true);
    try {
      const sb = createClient();
      await sb.auth.setSession({ access_token: token, refresh_token: '' });
      const types = ['notes', 'tasks', 'meals', 'activity', 'workouts'];
      const rows = await Promise.all(
        types.map(t => sb.from('entries').select('date, data, type')
          .eq('user_id', userId).eq('type', t).order('date', { ascending: false }).limit(400)
          .then(r => r.data || []))
      );
      const [notesR, tasksR, mealsR, activityR, workoutsR] = rows;
      const qL = q.toLowerCase();
      const hits = [];
      notesR.forEach(row => {
        (typeof row.data === 'string' ? row.data : '').split('\n').filter(l => l.trim()).forEach(line => {
          if (line.toLowerCase().includes(qL)) hits.push({ type: 'journal', date: row.date, text: line });
        });
      });
      tasksR.forEach(row => {
        (Array.isArray(row.data) ? row.data : []).forEach(task => {
          if (task?.text?.toLowerCase().includes(qL))
            hits.push({ type: 'task', date: row.date, text: task.text, done: task.done });
        });
      });
      mealsR.forEach(row => {
        (Array.isArray(row.data) ? row.data : []).forEach(meal => {
          if (meal?.text?.toLowerCase().includes(qL))
            hits.push({ type: 'meal', date: row.date, text: meal.text, kcal: meal.kcal });
        });
      });
      activityR.forEach(row => {
        (Array.isArray(row.data) ? row.data : []).forEach(act => {
          if (act?.text?.toLowerCase().includes(qL))
            hits.push({ type: 'activity', date: row.date, text: act.text });
        });
      });
      workoutsR.forEach(row => {
        (Array.isArray(row.data) ? row.data : []).forEach(w => {
          const t = w?.name || w?.text || '';
          if (t.toLowerCase().includes(qL)) hits.push({ type: 'activity', date: row.date, text: t });
        });
      });
      hits.sort((a, b) => b.date.localeCompare(a.date));
      setResults(hits.slice(0, 80));
    } catch(e) { setResults([]); }
    setLoading(false);
  }

  return { results, loading };
}

// ─── SearchResults: renders result blocks with keyword highlight ──────────────
function SearchResults({ results, loading, query, onSelectDate }) {
  const TYPE_LABEL = { journal: 'Journal', task: 'Task', meal: 'Meal', activity: 'Activity' };
  const TYPE_COLOR = { journal: C.accent, task: C.accent, meal: C.red, activity: C.blue };

  function highlight(text, q) {
    if (!q || !text) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: C.accent + '30', color: C.accent, borderRadius: 2, padding: '0 1px', fontStyle: 'normal' }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  if (loading && !results) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 40 }}>
      <span style={{ fontFamily: mono, fontSize: 9, color: C.muted, letterSpacing: '0.15em', textTransform: 'uppercase' }}>searching…</span>
    </div>
  );

  if (!results || query.trim().length < 2) return null;

  if (results.length === 0) return (
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 60 }}>
      <span style={{ fontFamily: mono, fontSize: 10, color: C.dim, letterSpacing: '0.06em' }}>No results match your search</span>
    </div>
  );

  // Group by date → then by type, preserving project-view card order
  const TYPE_ORDER = ['task', 'journal', 'meal', 'activity'];
  const TYPE_SECTION = { task: 'Tasks', journal: 'Journal', meal: 'Meals', activity: 'Activity' };
  const byDate = [];
  let lastDate = null;
  results.forEach(hit => {
    if (hit.date !== lastDate) { byDate.push({ date: hit.date, hits: [] }); lastDate = hit.date; }
    byDate[byDate.length - 1].hits.push(hit);
  });

  return (
    <div style={{ padding: '0 10px 180px' }}>
      {byDate.map(({ date, hits }) => {
        const byType = {};
        hits.forEach(h => { if (!byType[h.type]) byType[h.type] = []; byType[h.type].push(h); });
        const types = TYPE_ORDER.filter(t => byType[t]);
        return (
          <div key={date} style={{ marginBottom: 20 }}>
            {/* Date header */}
            <div
              onClick={() => onSelectDate && onSelectDate(date)}
              style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: C.muted, padding: '10px 2px 8px', cursor: 'pointer', display: 'inline-block',
                transition: 'color 0.15s' }}
              onMouseEnter={e => e.currentTarget.style.color = C.text}
              onMouseLeave={e => e.currentTarget.style.color = C.muted}
            >{fmtDate(date)}</div>

            {/* Per-type outlined card */}
            {types.map(type => (
              <div key={type}
                onClick={() => onSelectDate && onSelectDate(date)}
                style={{
                  marginBottom: 8, borderRadius: 10, cursor: 'pointer',
                  border: `1px solid ${C.border}`,
                  overflow: 'hidden',
                  transition: 'border-color 0.15s, background 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = C.surface;
                  e.currentTarget.style.borderColor = C.border2;
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'transparent';
                  e.currentTarget.style.borderColor = C.border;
                }}
              >
                {/* Card header — type label */}
                <div style={{
                  fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
                  color: TYPE_COLOR[type] + 'cc', padding: '7px 12px 5px',
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  {TYPE_SECTION[type]}
                </div>
                {/* Entries */}
                {byType[type].map((hit, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'flex-start', gap: 10,
                    padding: '7px 12px',
                    borderBottom: i < byType[type].length - 1 ? `1px solid ${C.border}` : 'none',
                  }}>
                    {type === 'task' && (
                      <div style={{ width: 13, height: 13, flexShrink: 0, borderRadius: 3, marginTop: 5,
                        border: `1.5px solid ${hit.done ? C.accent : C.border2}`,
                        background: hit.done ? C.accent : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {hit.done && <span style={{ fontSize: 9, color: C.bg, lineHeight: 1 }}>✓</span>}
                      </div>
                    )}
                    <div style={{ flex: 1, fontFamily: serif, fontSize: F.md, lineHeight: 1.6,
                      color: hit.done ? C.muted : C.text, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                      textDecoration: hit.done ? 'line-through' : 'none',
                      opacity: hit.done ? 0.5 : 1 }}>
                      {highlight(hit.text, query.trim())}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}


// ─── ProjectGraphView ─────────────────────────────────────────────────────────
function ProjectGraphView({ allTags, connections, onSelectProject, onBack }) {
  // Nodes and edges built once from props
  const graphRef = useRef(null); // {nodes, edges}
  const [ready, setReady] = useState(false);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [scale, setScale] = useState(1);
  const [hovered, setHovered] = useState(null);
  const containerRef = useRef(null);
  const dragStart = useRef(null);

  // Build graph + run force simulation in effect (never during render/hydration)
  useEffect(() => {
    const tagList = ['__health__', ...(allTags || [])];
    const lower = tagList.map(t => t.toLowerCase());
    const idxOf = {};
    lower.forEach((t, i) => { idxOf[t] = i; });

    const deg = new Array(tagList.length).fill(0);
    const edges = [];
    for (const c of (connections || [])) {
      const si = idxOf[c.source];
      const ti = idxOf[c.target];
      if (si == null || ti == null) continue;
      const w = Math.min(c.weight, 10);
      edges.push({ si, ti, w });
      deg[si]++;
      deg[ti]++;
    }
    const maxDeg = Math.max(1, ...deg);

    // Radial initial positions (no Math.random = deterministic, safe for hydration)
    const n = tagList.length;
    const nodes = tagList.map((name, i) => {
      const angle = (i / n) * Math.PI * 2;
      const radius = 180 + (deg[i] / maxDeg) * 80;
      return {
        id: name,
        label: name === '__health__' ? 'HEALTH' : tagDisplayName(name).toUpperCase(),
        color: name === '__health__' ? C.green : projectColor(name),
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        vx: 0, vy: 0,
        r: 16 + (deg[i] / maxDeg) * 14,
      };
    });

    // Force simulation
    const K = Math.sqrt((700 * 700) / Math.max(n, 1)) * 0.9;
    for (let iter = 0; iter < 280; iter++) {
      const alpha = (1 - iter / 280) * (1 - iter / 280);
      // Repulsion between all pairs
      for (let a = 0; a < nodes.length; a++) {
        for (let b = a + 1; b < nodes.length; b++) {
          const na = nodes[a]; const nb = nodes[b];
          let ddx = nb.x - na.x || 0.1; let ddy = nb.y - na.y || 0.1;
          const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
          const ff = (K * K / dd) * alpha * 0.5;
          na.vx -= (ddx / dd) * ff; na.vy -= (ddy / dd) * ff;
          nb.vx += (ddx / dd) * ff; nb.vy += (ddy / dd) * ff;
        }
      }
      // Spring attraction along edges
      for (const edge of edges) {
        const na = nodes[edge.si]; const nb = nodes[edge.ti];
        let ddx = nb.x - na.x; let ddy = nb.y - na.y;
        const dd = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const rest = K * (1.1 - edge.w * 0.04);
        const ff = (dd - rest) * 0.2 * alpha;
        na.vx += (ddx / dd) * ff; na.vy += (ddy / dd) * ff;
        nb.vx -= (ddx / dd) * ff; nb.vy -= (ddy / dd) * ff;
      }
      // Gravity toward center
      for (const node of nodes) {
        node.vx -= node.x * 0.012 * alpha;
        node.vy -= node.y * 0.012 * alpha;
        node.x += node.vx * 0.4;
        node.y += node.vy * 0.4;
        node.vx *= 0.7;
        node.vy *= 0.7;
      }
    }

    graphRef.current = { nodes, edges };
    setReady(true);

    // Fit after paint — defer so containerRef has real dimensions
    function doFit() {
      if (!containerRef.current) return;
      var rect = containerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        requestAnimationFrame(doFit);
        return;
      }
      var allX = nodes.map(function(nd) { return nd.x; });
      var allY = nodes.map(function(nd) { return nd.y; });
      var minX = Math.min.apply(null, allX) - 40;
      var maxX = Math.max.apply(null, allX) + 40;
      var minY = Math.min.apply(null, allY) - 40;
      var maxY = Math.max.apply(null, allY) + 40;
      var gW = maxX - minX;
      var gH = maxY - minY;
      var newScale = Math.min(0.95, Math.min(rect.width / gW, rect.height / gH));
      setScale(newScale);
      setTx(rect.width / 2 - ((minX + maxX) / 2) * newScale);
      setTy(rect.height / 2 - ((minY + maxY) / 2) * newScale);
    }
    requestAnimationFrame(doFit);
  }, []); // eslint-disable-line

  const PILL_SCALE = 0.85;
  const edgeAlpha = Math.max(0, Math.min(1, (scale - 0.2) / 0.4));

  function handleWheel(e) {
    e.preventDefault();
    if (!containerRef.current) return;
    var rect = containerRef.current.getBoundingClientRect();
    var mx = e.clientX - rect.left;
    var my = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 0.89;
    setScale(function(prev) { return Math.max(0.12, Math.min(3, prev * factor)); });
    setTx(function(prev) { return mx - (mx - prev) * factor; });
    setTy(function(prev) { return my - (my - prev) * factor; });
  }

  function handleMouseDown(e) {
    if (e.target.closest('[data-node]')) return;
    dragStart.current = { cx: e.clientX, cy: e.clientY, ox: tx, oy: ty };
  }
  function handleMouseMove(e) {
    if (!dragStart.current) return;
    setTx(dragStart.current.ox + e.clientX - dragStart.current.cx);
    setTy(dragStart.current.oy + e.clientY - dragStart.current.cy);
  }
  function handleMouseUp() { dragStart.current = null; }

  const { nodes, edges } = graphRef.current || { nodes: [], edges: [] };

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', background:C.bg, overflow:'auto' }}>
      {/* Quick-access cards at top */}
      <div style={{ flexShrink:0, display:'flex', gap:8, padding:'10px 14px 0' }}>
        <button onClick={() => onSelectProject('__everything__')}
          style={{ flex:1, background:C.accent+'0e', border:`1px solid ${C.accent}22`, borderRadius:10, padding:'10px 14px',
            cursor:'pointer', textAlign:'left', transition:'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background=C.accent+'1a'}
          onMouseLeave={e => e.currentTarget.style.background=C.accent+'0e'}>
          <div style={{ fontFamily:mono, fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:C.accent+'99', marginBottom:3 }}>All Journals</div>
          <div style={{ fontFamily:serif, fontSize:F.md, color:C.text }}>Every entry, all projects</div>
        </button>
        <button onClick={() => onSelectProject('__everything__')}
          style={{ flex:1, background:C.blue+'0e', border:`1px solid ${C.blue}22`, borderRadius:10, padding:'10px 14px',
            cursor:'pointer', textAlign:'left', transition:'background 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.background=C.blue+'1a'}
          onMouseLeave={e => e.currentTarget.style.background=C.blue+'0e'}>
          <div style={{ fontFamily:mono, fontSize:10, letterSpacing:'0.08em', textTransform:'uppercase', color:C.blue+'99', marginBottom:3 }}>All Tasks</div>
          <div style={{ fontFamily:serif, fontSize:F.md, color:C.text }}>Open tasks across projects</div>
        </button>
      </div>

      {/* Graph hint */}
      <div style={{ flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'10px 14px 6px' }}>
        <span style={{ fontFamily:mono, fontSize:10, color:C.dim }}>{(allTags||[]).length + 1} projects · scroll to zoom · drag to pan</span>
      </div>

      {/* Graph canvas */}
      {/* Canvas */}
      <div ref={containerRef}
        style={{ height:480, flexShrink:0, position:'relative', overflow:'hidden', cursor:'grab' }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}>
        {!ready && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center',
            fontFamily:mono, fontSize:F.sm, color:C.dim }}>Laying out graph…</div>
        )}
        {ready && (
          <svg width="100%" height="100%" style={{ display:'block' }}>
            <g transform={`translate(${tx},${ty}) scale(${scale})`}>
              {edgeAlpha > 0 && edges.map((edge, i) => {
                const na = nodes[edge.si]; const nb = nodes[edge.ti];
                if (!na || !nb) return null;
                return (
                  <line key={i}
                    x1={na.x} y1={na.y} x2={nb.x} y2={nb.y}
                    stroke={na.color}
                    strokeWidth={Math.max(0.4, edge.w * 0.35)}
                    strokeOpacity={edgeAlpha * 0.15 * Math.min(1, edge.w / 2)} />
                );
              })}
              {nodes.map((node, i) => {
                const isPill = scale >= PILL_SCALE;
                const isHov = hovered === i;
                const col = node.color;
                const pw = node.label.length * 7.2 + 26;
                return (
                  <g key={node.id} data-node="1"
                    transform={`translate(${node.x},${node.y})`}
                    style={{ cursor:'pointer' }}
                    onClick={() => onSelectProject(node.id)}
                    onMouseEnter={() => setHovered(i)}
                    onMouseLeave={() => setHovered(null)}>
                    {isPill ? (
                      <>
                        <rect x={-pw/2} y={-13} width={pw} height={26} rx={13}
                          fill={isHov ? col+'33' : col+'18'}
                          stroke={isHov ? col : col+'55'}
                          strokeWidth={isHov ? 1.5 : 1} />
                        <text x={0} y={4} textAnchor="middle"
                          style={{ fontFamily:mono, fontSize:10.5, fill:isHov ? col : col+'cc',
                            letterSpacing:'0.06em', pointerEvents:'none', userSelect:'none' }}>
                          {node.label}
                        </text>
                      </>
                    ) : (
                      <>
                        <circle r={node.r}
                          fill={isHov ? col+'33' : col+'18'}
                          stroke={isHov ? col : col+'55'}
                          strokeWidth={isHov ? 2 : 1.5} />
                        {scale >= 0.32 && (
                          <text y={node.r + 11} textAnchor="middle"
                            style={{ fontFamily:mono, fontSize:Math.max(8, 9 / scale),
                              fill:col+'99', pointerEvents:'none', userSelect:'none' }}>
                            {node.label.length > 9 ? node.label.slice(0,8)+'…' : node.label}
                          </text>
                        )}
                      </>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        )}
        {/* Zoom buttons */}
        <div style={{ position:'absolute', bottom:16, right:16, display:'flex', flexDirection:'column', gap:4 }}>
          {[{label:'+',f:1.25},{label:'−',f:0.8}].map(({label,f}) => (
            <button key={label}
              onClick={() => setScale(prev => Math.max(0.12, Math.min(3, prev * f)))}
              style={{ width:30, height:30, background:C.surface, border:`1px solid ${C.border2}`, borderRadius:6,
                color:C.muted, fontFamily:mono, fontSize:16, cursor:'pointer',
                display:'flex', alignItems:'center', justifyContent:'center' }}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}


// ─── ProjectsCard ─────────────────────────────────────────────────────────────
// Source of truth: #tags present in the DB (notes + tasks). projectsMeta is
// metadata-only (description). No tag in DB = no project button, period.
function ProjectsCard({ date, token, userId, onSelectProject }) {
  const { value: notes } = useDbSave(date, 'notes', '', token, userId);
  const { value: tasks }  = useDbSave(date, 'tasks', [], token, userId);
  // projectsMeta is metadata-only (descriptions). NOT source of truth for project existence.
  const { value: projectsMeta } = useDbSave('global', 'projects', {}, token, userId);

  // Which tags exist in today's entries (for active/dim styling)
  const todayTags = useMemo(() => {
    const s = new Set();
    extractTags(notes || '').forEach(t => s.add(t.toLowerCase()));
    (Array.isArray(tasks) ? tasks : []).forEach(r => {
      if (r?.text) extractTags(r.text).forEach(t => s.add(t.toLowerCase()));
    });
    return s;
  }, [notes, tasks]);

  // Tags that actually exist anywhere in the DB — fetched from /api/all-tags
  const [allTags, setAllTags] = useState(null); // null=loading
  const [connections, setConnections] = useState([]);
  const [recency, setRecency] = useState({});
  const fetchedRef = useRef(false);
  useEffect(() => {
    if (!token || fetchedRef.current) return;
    fetchedRef.current = true;
    Promise.all([
      fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/tag-connections', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(function(results) {
      var tagsRes = results[0];
      var connsRes = results[1];
      setAllTags(Array.isArray(tagsRes.tags) ? tagsRes.tags : []);
      setConnections(Array.isArray(connsRes.connections) ? connsRes.connections : []);
      setRecency(connsRes.recency || {});
    }).catch(function() { setAllTags([]); });
  }, [token]); // eslint-disable-line

  // Re-fetch when today's notes/tasks change (new tag added or deleted)
  const prevTagsKey = useRef('');
  useEffect(() => {
    const key = todayTags ? [...todayTags].sort().join(',') : '';
    if (key === prevTagsKey.current || !token) return;
    prevTagsKey.current = key;
    fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => setAllTags(Array.isArray(d.tags) ? d.tags : []))
      .catch(() => {});
  }, [todayTags, token]); // eslint-disable-line

  // Sort by recency, show top 6 in strip
  const _pcSorted = useMemo(function() {
    if (!allTags) return [];
    return allTags.slice().sort(function(a, b) {
      var ra = recency[a.toLowerCase()] || '0';
      var rb = recency[b.toLowerCase()] || '0';
      return rb < ra ? -1 : rb > ra ? 1 : 0;
    });
  }, [allTags, recency]); // eslint-disable-line
  var names = _pcSorted.slice(0, 6);
  var pcHasMore = _pcSorted.length > 6;

  const pcScrollRef = useRef(null);
  const [pcFade, setPcFade] = useState(false);
  useEffect(() => {
    const el = pcScrollRef.current;
    if (!el) return;
    const check = () => {
      const hasOverflow = el.scrollWidth > el.clientWidth + 2;
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
      setPcFade(hasOverflow && !atEnd);
    };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    el.addEventListener('scroll', check, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', check); };
  }, [names.length]); // eslint-disable-line

  if (allTags === null) return null;

  // Package icon SVG (grid of dots)
  const PackageIcon = (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );

  return (
    <div style={{ position:'relative', display:'flex', alignItems:'center', gap:0, padding:'4px 0' }}>
      {/* Package icon — opens graph/projects view */}
      <button
        onClick={() => onSelectProject('__graph__')}
        title="All Projects"
        style={{
          background:'none', border:'none', cursor:'pointer',
          padding:'4px 8px 4px 14px', color:C.dim, flexShrink:0,
          display:'flex', alignItems:'center', opacity:0.5,
          transition:'opacity 0.15s, color 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.color=C.accent; }}
        onMouseLeave={e => { e.currentTarget.style.opacity='0.5'; e.currentTarget.style.color=C.dim; }}
      >{PackageIcon}</button>

      {/* Divider */}
      <div style={{width:1, height:16, background:C.border2, flexShrink:0, marginRight:6}}/>

      {/* Scrollable chips */}
      <div
        ref={pcScrollRef}
        style={{
          display:'flex', alignItems:'center', flexWrap:'nowrap', gap:6,
          padding:'4px 0', overflowX:'auto', scrollbarWidth:'none', msOverflowStyle:'none',
          flex:1, minWidth:0,
        }}
      >
        {/* Health — always first */}
        <button
          onClick={() => onSelectProject('__health__')}
          style={{
            background: C.green + '11', border:`1px solid ${C.green}33`,
            borderRadius:20, padding:'2px 10px',
            fontFamily:mono, fontSize:F.sm, color:C.green+'aa',
            cursor:'pointer', transition:'all 0.15s',
            letterSpacing:'0.03em', lineHeight:'1.8',
            whiteSpace:'nowrap', flexShrink:0,
          }}
          onMouseEnter={e => { e.currentTarget.style.background=C.green+'22'; e.currentTarget.style.color=C.green; }}
          onMouseLeave={e => { e.currentTarget.style.background=C.green+'11'; e.currentTarget.style.color=C.green+'aa'; }}
        >HEALTH</button>

        {/* Recent project chips */}
        {names.map(name => {
          const active = todayTags.has(name.toLowerCase());
          const col = projectColor(name);
          return (
            <button
              key={name}
              onClick={() => onSelectProject(name)}
              style={{
                background: active ? col+'22' : 'transparent',
                border:`1px solid ${active ? col+'55' : C.border2}`,
                borderRadius:20, padding:'2px 10px',
                fontFamily:mono, fontSize:F.sm, color: active ? col : C.muted,
                cursor:'pointer', opacity: active ? 1 : 0.35,
                transition:'opacity 0.15s, color 0.15s',
                letterSpacing:'0.03em', lineHeight:'1.8',
                whiteSpace:'nowrap', flexShrink:0,
              }}
              onMouseEnter={e => { e.currentTarget.style.opacity='1'; e.currentTarget.style.color=col; }}
              onMouseLeave={e => { e.currentTarget.style.opacity=active?'1':'0.35'; e.currentTarget.style.color=active?col:C.muted; }}
            >{tagDisplayName(name).toUpperCase()}</button>
          );
        })}
      </div>

      {/* Right fade */}
      <div style={{
        position:'absolute', right:0, top:0, bottom:0, width:32, pointerEvents:'none',
        background:`linear-gradient(to right, transparent, ${C.bg})`,
        opacity: pcFade ? 1 : 0, transition:'opacity 0.12s ease',
      }}/>
    </div>
  );
}

// Shared date formatter used by ProjectView + HealthProjectView
function fmtDate(ds) {
  const d = new Date(ds + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── AddJournalLine — inline entry input; supports uncontrolled (default) or controlled (value+onChange) ──
function AddJournalLine({ project, onAdd, placeholder, value: controlledValue, onChange: controlledOnChange }) {
  const [internalText, setInternalText] = useState('');
  const isControlled = controlledValue !== undefined;
  const text = isControlled ? controlledValue : internalText;
  const setText = isControlled ? controlledOnChange : setInternalText;
  const col = project && project !== '__everything__' && project !== '__health__' ? projectColor(project) : C.accent;
  function commit() {
    if (text.trim()) { onAdd(text.trim()); if (!isControlled) setText(''); }
  }
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
      <input
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }}
        onBlur={commit}
        placeholder={placeholder || 'Add an entry…'}
        style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none',
          fontFamily: serif, fontSize: F.md, color: C.text, caretColor: col }}
      />
    </div>
  );
}

// ─── HealthAllMeals ───────────────────────────────────────────────────────────
function HealthAllMeals({ token, userId, onSelectDate, onBack }) {
  const [allMeals, setAllMeals] = useState(null);
  const [addText, setAddText] = useState('');
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (!token || !userId) return;
    const sb = createClient();
    sb.from('entries').select('date, data')
      .eq('user_id', userId).eq('type', 'meals')
      .order('date', { ascending: false })
      .then(({ data }) => {
        const rows = (data || []).flatMap(row => {
          const items = Array.isArray(row.data) ? row.data : [];
          return items.filter(r => r?.text?.trim()).map(r => ({ date: row.date, ...r }));
        });
        setAllMeals(rows);
      });
  }, [token, userId]);

  async function commitMeal() {
    const text = addText.trim();
    if (!text) return;
    setAddText('');
    const current = await dbLoad(todayStr, 'meals', token);
    const existing = Array.isArray(current) ? current.filter(r => r.text) : [];
    const newRow = { id: Date.now(), text, kcal: null, protein: null };
    await dbSave(todayStr, 'meals', [...existing, newRow], token);
    MEM[`${userId}:${todayStr}:meals`] = [...existing, newRow];
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['meals'] } }));
    setAllMeals(prev => [...(prev || []), { date: todayStr, ...newRow }]);
    estimateNutrition(`Estimate for: "${text}". Return JSON: {"kcal":420,"protein":30}`, token)
      .then(result => {
        if (result) setAllMeals(prev => (prev||[]).map(r => r.id === newRow.id ? {...r, kcal: result.kcal||null, protein: result.protein||null} : r));
      });
  }

  const PROT_W = 50, ENRG_W = 72;
  const colProtein  = {fontFamily:mono,fontSize:F.sm,color:C.blue,  flexShrink:0,width:PROT_W,textAlign:'center',whiteSpace:'nowrap'};
  const colKcal     = {fontFamily:mono,fontSize:F.sm,color:C.orange,flexShrink:0,width:ENRG_W,textAlign:'center',whiteSpace:'nowrap'};
  const colMutedP   = {fontFamily:mono,fontSize:F.sm,color:C.muted, flexShrink:0,width:PROT_W,textAlign:'center',whiteSpace:'nowrap'};
  const colMutedE   = {fontFamily:mono,fontSize:F.sm,color:C.muted, flexShrink:0,width:ENRG_W,textAlign:'center',whiteSpace:'nowrap'};
  const chipBase    = {fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',flexShrink:0,borderRadius:4,padding:'2px 8px',whiteSpace:'nowrap'};
  const rowS        = {display:'flex',alignItems:'center',gap:0,padding:'3px 0',minHeight:28};

  if (!allMeals) return <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>;

  const todayMeals = allMeals.filter(r => r.date === todayStr);
  const pastMeals  = allMeals.filter(r => r.date !== todayStr);
  const byDate = {};
  pastMeals.forEach(r => { if (!byDate[r.date]) byDate[r.date] = []; byDate[r.date].push(r); });
  const todayKcal    = todayMeals.reduce((s,r) => s+(r.kcal||0), 0);
  const todayProtein = todayMeals.reduce((s,r) => s+(r.protein||0), 0);

  function DateLabel({ date, isToday }) {
    return (
      <div
        onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
        style={{fontFamily:mono,fontSize:10,
          color:isToday?C.accent:C.muted,
          letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4,
          cursor:(!isToday&&onSelectDate)?'pointer':'default',
          display:'inline-block',transition:'color 0.15s'}}
        onMouseEnter={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.text;}}
        onMouseLeave={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.muted;}}
      >{isToday ? 'Today' : fmtDate(date)}</div>
    );
  }

  return (
    <div>
      {/* ── Today section — always shown ── */}
      <DateLabel date={todayStr} isToday />
      <AddJournalLine
        onAdd={commitMeal}
        placeholder="Add a meal…"
        value={addText}
        onChange={setAddText}
      />
      {todayMeals.map((r, i) => (
        <div key={r.id||i} style={rowS}>
          <span style={{flex:1,lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{r.text}</span>
          <span style={r.protein ? colProtein : colMutedP}>{r.protein ? `${r.protein}g` : '—'}</span>
          <span style={r.kcal    ? colKcal    : colMutedE}>{r.kcal    ? `${r.kcal}kcal` : '—'}</span>
        </div>
      ))}
      {(todayKcal > 0 || todayProtein > 0) && (
        <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
          <div style={{flex:1}}/>
          <div style={{width:PROT_W,display:'flex',justifyContent:'center'}}>
            {todayProtein > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{todayProtein}g</span>}
          </div>
          <div style={{width:ENRG_W,display:'flex',justifyContent:'center'}}>
            {todayKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{todayKcal}kcal</span>}
          </div>
        </div>
      )}
      {/* ── Past dates ── */}
      {Object.entries(byDate).sort(([a],[b])=>b.localeCompare(a)).map(([date, rows], di) => {
        const totalKcal    = rows.reduce((s,r) => s+(r.kcal||0), 0);
        const totalProtein = rows.reduce((s,r) => s+(r.protein||0), 0);
        return (
          <div key={date}>
            <div style={{height:1,background:C.border,margin:'8px 0'}}/>
            <DateLabel date={date} isToday={false} />
            {rows.map((r, i) => (
              <div key={i} style={rowS}>
                <span style={{flex:1,lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',minWidth:0}}>{r.text}</span>
                <span style={r.protein ? colProtein : colMutedP}>{r.protein ? `${r.protein}g` : '—'}</span>
                <span style={r.kcal    ? colKcal    : colMutedE}>{r.kcal    ? `${r.kcal}kcal` : '—'}</span>
              </div>
            ))}
            {(totalKcal > 0 || totalProtein > 0) && (
              <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
                <div style={{flex:1}}/>
                <div style={{width:PROT_W,display:'flex',justifyContent:'center'}}>
                  {totalProtein > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{totalProtein}g</span>}
                </div>
                <div style={{width:ENRG_W,display:'flex',justifyContent:'center'}}>
                  {totalKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{totalKcal}kcal</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── HealthAllActivities ──────────────────────────────────────────────────────
function HealthAllActivities({ token, userId, onSelectDate, onBack }) {
  const [rows, setRows] = useState(null);
  const [estimating, setEstimating] = useState(new Set());

  useEffect(() => {
    if (!token || !userId) return;
    const sb = createClient();
    Promise.all([
      // Synced workouts (already normalized: {id,text,source,dist,pace,kcal})
      sb.from('entries').select('date, data').eq('user_id', userId).eq('type', 'workouts').order('date', { ascending: false }),
      // Manual activity rows: {id,text,dist,pace,kcal}
      sb.from('entries').select('date, data').eq('user_id', userId).eq('type', 'activity').order('date', { ascending: false }),
    ]).then(([{ data: wktData }, { data: actData }]) => {
      const seen = new Set();
      const all = [];
      // Synced first (higher quality)
      for (const row of (wktData || [])) {
        for (const r of (Array.isArray(row.data) ? row.data : [])) {
          if (!r?.text?.trim()) continue;
          const key = `${row.date}:${r.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({ date: row.date, id: r.id || key, text: r.text, source: r.source||null, dist: r.dist||null, pace: r.pace||null, kcal: r.kcal||null });
        }
      }
      // Manual entries
      for (const row of (actData || [])) {
        for (const r of (Array.isArray(row.data) ? row.data : [])) {
          if (!r?.text?.trim()) continue;
          const key = `${row.date}:${r.text}`;
          if (seen.has(key)) continue;
          seen.add(key);
          all.push({ date: row.date, id: r.id || key, text: r.text, source: null, dist: r.dist||null, pace: r.pace||null, kcal: r.kcal||null });
        }
      }
      setRows(all);
    });
  }, [token, userId]);

  // AI kcal estimation for rows missing kcal
  useEffect(() => {
    if (!rows || !token) return;
    const missing = rows.filter(r => r.text && !r.kcal && !estimating.has(r.id));
    if (!missing.length) return;
    setEstimating(prev => new Set([...prev, ...missing.map(r => r.id)]));
    missing.forEach(row => {
      estimateNutrition(`Calories burned for: "${row.text}"${row.dist ? ` (${row.dist})` : ''} for a typical adult. Return JSON: {"kcal":300}`, token)
        .then(result => {
          if (result?.kcal) setRows(prev => (prev||[]).map(r => r.id === row.id ? {...r, kcal: result.kcal} : r));
          setEstimating(prev => { const n = new Set(prev); n.delete(row.id); return n; });
        });
    });
  }, [rows?.map(r=>r.id).join(','), token]); // eslint-disable-line

  const KCOL=72, DCOL=60, PCOL=100;
  const colDist   = {fontFamily:mono,fontSize:F.sm,color:C.blue,   flexShrink:0,width:DCOL,textAlign:'center',whiteSpace:'nowrap'};
  const colPace   = {fontFamily:mono,fontSize:F.sm,color:C.green,  flexShrink:0,width:PCOL,textAlign:'center',whiteSpace:'nowrap'};
  const colKcal   = {fontFamily:mono,fontSize:F.sm,color:C.orange, flexShrink:0,width:KCOL, textAlign:'center',whiteSpace:'nowrap'};
  const colMuted  = (w) => ({fontFamily:mono,fontSize:F.sm,color:C.muted,flexShrink:0,width:w,textAlign:'center',whiteSpace:'nowrap'});
  const chipBase  = {fontFamily:mono,fontSize:F.sm,letterSpacing:'0.04em',flexShrink:0,borderRadius:4,padding:'2px 8px',whiteSpace:'nowrap'};
  const rowS      = {display:'flex',alignItems:'center',gap:0,padding:'3px 0',minHeight:28};

  const [actAddText, setActAddText] = useState('');
  const todayStr = new Date().toISOString().slice(0, 10);

  async function commitActivity() {
    const text = actAddText.trim();
    if (!text) return;
    setActAddText('');
    const current = await dbLoad(todayStr, 'activity', token);
    const existing = Array.isArray(current) ? current.filter(r => r.text) : [];
    const newRow = { id: Date.now(), text, dist: null, pace: null, kcal: null };
    await dbSave(todayStr, 'activity', [...existing, newRow], token);
    MEM[`${userId}:${todayStr}:activity`] = [...existing, newRow];
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['activity'] } }));
    setRows(prev => [...(prev || []), { date: todayStr, ...newRow }]);
    estimateNutrition(`Calories burned for: "${text}" for a typical adult. Return JSON: {"kcal":300}`, token)
      .then(result => {
        if (result?.kcal) setRows(prev => (prev||[]).map(r => r.id === newRow.id ? {...r, kcal: result.kcal} : r));
      });
  }

  if (!rows) return <div style={{display:'flex',flexDirection:'column',gap:8,padding:'4px 0'}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>;

  function parseDist(d){ const m=String(d||'').match(/[\d.]+/); return m?+m[0]:null; }

  const withData = rows.filter(r => r.text);
  const todayRows = withData.filter(r => r.date === todayStr);
  const pastRows  = withData.filter(r => r.date !== todayStr);
  const byDate = {};
  pastRows.forEach(r => { if (!byDate[r.date]) byDate[r.date] = []; byDate[r.date].push(r); });
  const todayKcal = todayRows.reduce((s,r) => s+(r.kcal||0), 0);
  const todayDistVals = todayRows.map(r => parseDist(r.dist)).filter(Boolean);
  const todayDist = todayDistVals.length ? todayDistVals.reduce((a,b)=>a+b,0) : 0;

  function ActDateLabel({ date, isToday }) {
    return (
      <div
        onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
        style={{fontFamily:mono,fontSize:10,
          color:isToday?C.accent:C.muted,
          letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4,
          cursor:(!isToday&&onSelectDate)?'pointer':'default',
          display:'inline-block',transition:'color 0.15s'}}
        onMouseEnter={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.text;}}
        onMouseLeave={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.muted;}}
      >{isToday ? 'Today' : fmtDate(date)}</div>
    );
  }

  return (
    <div>
      {/* ── Today section — always shown ── */}
      <ActDateLabel date={todayStr} isToday />
      <AddJournalLine
        onAdd={commitActivity}
        placeholder="Add an activity…"
        value={actAddText}
        onChange={setActAddText}
      />
      {todayRows.map((r, i) => (
        <div key={r.id||i} style={rowS}>
          <span style={{display:'flex',alignItems:'center',gap:6,flex:1,minWidth:0,overflow:'hidden'}}>
            <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.text}</span>
            <SourceBadge source={r.source}/>
          </span>
          <span style={r.dist ? colDist : colMuted(DCOL)}>{r.dist || '—'}</span>
          <span style={r.pace ? colPace : colMuted(PCOL)}>{r.pace ? `${r.pace}/mi` : '—'}</span>
          <span style={r.kcal ? colKcal : colMuted(KCOL)}>
            {estimating.has(r.id) ? '…' : r.kcal ? `-${r.kcal}kcal` : '—'}
          </span>
        </div>
      ))}
      {(todayKcal > 0 || todayDist > 0) && (
        <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
          <div style={{flex:1}}/>
          <div style={{width:DCOL,display:'flex',justifyContent:'center'}}>
            {todayDist > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{todayDist.toFixed(1)}mi</span>}
          </div>
          <div style={{width:PCOL}}/>
          <div style={{width:KCOL,display:'flex',justifyContent:'center'}}>
            {todayKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{todayKcal}kcal</span>}
          </div>
        </div>
      )}
      {/* ── Past dates ── */}
      {Object.entries(byDate).sort(([a],[b])=>b.localeCompare(a)).map(([date, dateRows], di) => {
        const totalKcal = dateRows.reduce((s,r) => s+(r.kcal||0), 0);
        const distVals  = dateRows.map(r => parseDist(r.dist)).filter(Boolean);
        const totalDist = distVals.length ? distVals.reduce((a,b)=>a+b,0) : 0;
        return (
          <div key={date}>
            <div style={{height:1,background:C.border,margin:'8px 0'}}/>
            <ActDateLabel date={date} isToday={false} />
            {dateRows.map((r, i) => (
              <div key={r.id||i} style={rowS}>
                <span style={{display:'flex',alignItems:'center',gap:6,flex:1,minWidth:0,overflow:'hidden'}}>
                  <span style={{lineHeight:1.7,color:C.text,fontFamily:serif,fontSize:F.md,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{r.text}</span>
                  <SourceBadge source={r.source}/>
                </span>
                <span style={r.dist ? colDist : colMuted(DCOL)}>{r.dist || '—'}</span>
                <span style={r.pace ? colPace : colMuted(PCOL)}>{r.pace ? `${r.pace}/mi` : '—'}</span>
                <span style={r.kcal ? colKcal : colMuted(KCOL)}>
                  {estimating.has(r.id) ? '…' : r.kcal ? `-${r.kcal}kcal` : '—'}
                </span>
              </div>
            ))}
            {(totalKcal > 0 || totalDist > 0) && (
              <div style={{display:'flex',alignItems:'center',gap:0,paddingTop:4,marginTop:2}}>
                <div style={{flex:1}}/>
                <div style={{width:DCOL,display:'flex',justifyContent:'center'}}>
                  {totalDist > 0 && <span style={{...chipBase,background:C.blue+'22',color:C.blue}}>{totalDist.toFixed(1)}mi</span>}
                </div>
                <div style={{width:PCOL}}/>
                <div style={{width:KCOL,display:'flex',justifyContent:'center'}}>
                  {totalKcal > 0 && <span style={{...chipBase,background:C.orange+'22',color:C.orange}}>{totalKcal}kcal</span>}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
// ─── HealthProjectView ───────────────────────────────────────────────────────
function HealthProjectView({ token, userId, onBack, onHealthChange, onScoresReady, startSync, endSync, onSelectDate, taskFilter, setTaskFilter }) {
  const today = new Date().toISOString().slice(0, 10);
  const [entries, setEntries] = useState(null);
  const pvTaskFilter = taskFilter;
  const setPvTaskFilter = setTaskFilter;
  const [vw, setVw] = useState(() => typeof window !== 'undefined' ? window.innerWidth : 800);
  useEffect(() => {
    const fn = () => setVw(window.innerWidth);
    window.addEventListener('resize', fn);
    return () => window.removeEventListener('resize', fn);
  }, []);
  const wide = vw >= 900;

  // Collapse state for health project widgets (persisted)
  const [healthCollapsed,     toggleHealth]     = useCollapse('hpv:health',     false);
  const [mealsCollapsed,      toggleMeals]      = useCollapse('hpv:meals',      false);
  const [activitiesCollapsed, toggleActivities] = useCollapse('hpv:activities', false);
  const [tasksCollapsed,      toggleTasks]      = useCollapse('hpv:tasks',      false);
  const [entriesCollapsed,    toggleEntries]    = useCollapse('hpv:entries',    false);

  useEffect(() => {
    if (!token) return;
    setEntries(null);
    fetch('/api/project-entries?project=__health__', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(r => r.json()).then(d => {
      setEntries(d.error ? { journalEntries: [], taskEntries: [] } : d);
    }).catch(() => setEntries({ journalEntries: [], taskEntries: [] }));
  }, [token]);

  const taskEntries = entries?.taskEntries || [];
  const journalEntries = entries?.journalEntries || [];
  const openTasks = taskEntries.filter(t => !t.done);

  const tasksByDate = useMemo(() => {
    if (!taskEntries.length) return [];
    const map = {};
    taskEntries.forEach(t => {
      if (!map[t.date]) map[t.date] = { open: [], done: [] };
      if (t.done) map[t.date].done.push(t); else map[t.date].open.push(t);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [taskEntries]);

  const journalByDate = useMemo(() => {
    if (!journalEntries.length) return [];
    const map = {};
    journalEntries.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => b.localeCompare(a));
  }, [journalEntries]);

  const tasksWidget = (
    <Widget
      label={taskEntries.length ? `Tasks · ${openTasks.length} open` : 'Tasks'}
      color={C.blue} autoHeight
      collapsed={tasksCollapsed} onToggle={toggleTasks}
      headerRight={<TaskFilterBtns filter={pvTaskFilter} setFilter={setPvTaskFilter}/>}
    >
      {entries === null ? (
        <div style={{display:'flex',flexDirection:'column',gap:8}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>
      ) : (() => {
        const todayStr = todayKey(); // local date — matches addNewTask and day view
        const otherDates = tasksByDate.filter(([d]) => d !== todayStr).sort(([a],[b]) => b.localeCompare(a));
        const todayEntry = tasksByDate.find(([d]) => d === todayStr);
        const allDates = todayEntry
          ? [[todayStr, todayEntry[1]], ...otherDates]
          : [[todayStr, { all:[], open:[], done:[] }], ...otherDates];
        return (
          <div>
            {allDates.filter(([date, { open, done }]) =>
              pvTaskFilter === 'open' ? (open.length > 0 || date === todayStr) :
              pvTaskFilter === 'done' ? (done.length > 0 || date === todayStr) : true
            ).map(([date, { open, done }], dateIdx) => {
              const isToday = date === todayStr;
              return (
                <div key={date}>
                  <div style={{fontFamily:mono,fontSize:10,
                    color:isToday?C.accent:C.muted,
                    letterSpacing:'0.06em',textTransform:'uppercase',
                    marginTop:dateIdx===0?0:4,marginBottom:6}}>
                    {isToday ? 'Today' : fmtDate(date)}
                  </div>
                  {isToday && pvTaskFilter !== 'done' && (
                    <NewProjectTask project="__health__" onAdd={async text => {
                      const taskText = text.trim().toLowerCase().includes('#health') ? text.trim() : text.trim() + ' #Health';
                      const current = await dbLoad(todayStr, 'tasks', token);
                      const existing = Array.isArray(current) ? current : [];
                      const newTask = { id: Date.now(), text: taskText, done: false };
                      const updated = [...existing, newTask];
                      await dbSave(todayStr, 'tasks', updated, token);
                      MEM[`${userId}:${todayStr}:tasks`] = updated;
                      window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['tasks'] } }));
                      setEntries(prev => prev ? {
                        ...prev,
                        taskEntries: [...(prev.taskEntries||[]), { date: todayStr, id: newTask.id, text: taskText, done: false }],
                      } : prev);
                    }} />
                  )}
                  {pvTaskFilter !== 'done' && open.map(task => (
                    <div key={task.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'3px 0'}}>
                      <div style={{width:14,height:14,flexShrink:0,marginTop:4,borderRadius:3,border:`1.5px solid ${C.border2}`,background:'transparent'}}/>
                      <div style={{flex:1,fontFamily:serif,fontSize:F.md,lineHeight:'1.7',color:C.text,whiteSpace:'pre-wrap',wordBreak:'break-word'}}>{renderRichLine(task.text)}</div>
                    </div>
                  ))}
                  {pvTaskFilter !== 'open' && done.map(task => (
                    <div key={task.id} style={{display:'flex',alignItems:'flex-start',gap:10,padding:'3px 0',opacity:0.45}}>
                      <div style={{width:14,height:14,flexShrink:0,marginTop:4,borderRadius:3,border:`1.5px solid ${C.accent}`,background:C.accent,display:'flex',alignItems:'center',justifyContent:'center'}}>
                        <span style={{fontSize:10,color:C.bg,lineHeight:1}}>✓</span>
                      </div>
                      <div style={{flex:1,fontFamily:serif,fontSize:F.md,lineHeight:'1.7',color:C.muted,textDecoration:'line-through'}}>{renderRichLine(task.text)}</div>
                    </div>
                  ))}
                  {dateIdx < allDates.length - 1 && <div style={{borderTop:`1px solid ${C.border}`,marginTop:12,marginBottom:4}}/>}
                </div>
              );
            })}
          </div>
        );
      })()}
    </Widget>
  );

  const entriesWidget = (
    <Widget
      label={journalEntries.length ? `Entries · ${journalEntries.length}` : 'Entries'}
      color={C.accent} autoHeight
      collapsed={entriesCollapsed} onToggle={toggleEntries}
    >
      {entries === null ? (
        <div style={{display:'flex',flexDirection:'column',gap:8}}><Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/></div>
      ) : (() => {
        const todayStr = todayKey(); // local date — matches day view
        const otherDates = journalByDate.filter(([d]) => d !== todayStr);
        const todayLines = journalByDate.find(([d]) => d === todayStr)?.[1] || [];
        const allDates = [[todayStr, todayLines], ...otherDates];
        return (
          <div>
            {allDates.map(([date, lines], dateIdx) => {
              const isToday = date === todayStr;
              if (!isToday && lines.length === 0) return null;
              return (
                <div key={date}>
                  {dateIdx > 0 && <div style={{height:1,background:C.border,margin:'8px 0'}}/>}
                  <div
                    onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
                    style={{fontFamily:mono,fontSize:10,
                      color:isToday?C.accent:C.muted,
                      letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:6,
                      cursor:(!isToday&&onSelectDate)?'pointer':'default',
                      display:'inline-block',transition:'color 0.15s'}}
                    onMouseEnter={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.text;}}
                    onMouseLeave={e=>{if(!isToday&&onSelectDate)e.currentTarget.style.color=C.muted;}}
                  >{isToday ? 'Today' : fmtDate(date)}</div>
                  {isToday && (
                    <AddJournalLine project="__health__" onAdd={async text => {
                      const entryText = text.trim().toLowerCase().includes('#health') ? text.trim() : text.trim() + ' #Health';
                      const current = await dbLoad(todayStr, 'notes', token);
                      const existing = (typeof current === 'string' ? current : '') || '';
                      const updated = existing ? existing.trimEnd() + "\n" + entryText : entryText;
                      const newLineIndex = updated.split("\n").lastIndexOf(entryText);
                      await dbSave(todayStr, 'notes', updated, token);
                      MEM[`${userId}:${todayStr}:notes`] = updated;
                      window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['notes'] } }));
                      setEntries(prev => prev ? {
                        ...prev,
                        journalEntries: [...(prev.journalEntries||[]), { date: todayStr, lineIndex: newLineIndex, text: entryText }],
                      } : prev);
                    }} placeholder="Add a health journal entry…" />
                  )}
                  {lines.map((entry, i) => (
                    <div key={i} style={{fontFamily:serif,fontSize:F.md,lineHeight:'1.7',color:C.text,padding:'1px 0'}}>
                      {renderRichLine(entry.text)}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        );
      })()}
    </Widget>
  );

  const mealsWidget = (
    <Widget label="Meals" color={C.red} autoHeight collapsed={mealsCollapsed} onToggle={toggleMeals}
      headerRight={<span style={{display:'flex',gap:0}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:50,textAlign:'center'}}>prot</span>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:72,textAlign:'center'}}>energy</span>
      </span>}
    >
      <HealthAllMeals token={token} userId={userId} onSelectDate={onSelectDate} onBack={onBack} />
    </Widget>
  );

  const activitiesWidget = (
    <Widget label="Activity" color={C.green} autoHeight collapsed={activitiesCollapsed} onToggle={toggleActivities}
      headerRight={<span style={{display:'flex',gap:0}}>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:60,textAlign:'center'}}>dist</span>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:100,textAlign:'center'}}>pace</span>
        <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.06em',textTransform:'uppercase',color:C.dim,width:72,textAlign:'center'}}>energy</span>
      </span>}
    >
      <HealthAllActivities token={token} userId={userId} onSelectDate={onSelectDate} onBack={onBack} />
    </Widget>
  );

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:10, padding:10, paddingTop:6, paddingBottom:200,
      maxWidth:1200, width:'100%', margin:'0 auto', boxSizing:'border-box' }}>
      {/* Health strip — collapsible */}
      <HealthStrip
        date={today} token={token} userId={userId}
        onHealthChange={onHealthChange || (()=>{})}
        onScoresReady={onScoresReady || (()=>{})}
        onSyncStart={startSync || (()=>{})}
        onSyncEnd={endSync || (()=>{})}
        collapsed={healthCollapsed} onToggle={toggleHealth}
      />

      {/* Wide: two-column layout 50/50; narrow: single column */}
      {wide ? (
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, alignItems:'start' }}>
          {/* Left col: Tasks, Entries */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, minWidth:0 }}>
            {tasksWidget}
            {entriesWidget}
          </div>
          {/* Right col: Meals, Activity */}
          <div style={{ display:'flex', flexDirection:'column', gap:10, minWidth:0 }}>
            {mealsWidget}
            {activitiesWidget}
          </div>
        </div>
      ) : (
        <>
          {tasksWidget}
          {entriesWidget}
          {mealsWidget}
          {activitiesWidget}
        </>
      )}
    </div>
  );
}

// ─── EntryLine — stable-height edit line for ProjectView ─────────────────────
function EntryLine({ entry, date, editing, onStartEdit, onSave, dimTag }) {
  const baseStyle = { fontFamily: serif, fontSize: F.md, lineHeight: '1.7', padding: '2px 0', wordBreak: 'break-word' };

  if (editing) {
    return (
      <DayLabEditor
        value={entry.text}
        onBlur={text => onSave(text)}
        placeholder=""
        singleLine
        textColor={C.text}
        mutedColor={C.dim}
        color={C.accent}
        style={{ width: '100%', minHeight: '1.7em' }}
      />
    );
  }
  return (
    <div style={{ ...baseStyle, color:C.text, cursor:'text', whiteSpace:'pre-wrap' }} onClick={onStartEdit}>
      {renderRichLine(entry.text, dimTag)}
    </div>
  );
}

// ─── ProjectView ──────────────────────────────────────────────────────────────
function ProjectView({ project, token, userId, onBack, onSelectDate, taskFilter, setTaskFilter }) {
  const { value: projectsMeta, setValue: setProjectsMeta } =
    useDbSave('global', 'projects', {}, token, userId);

  const [entries, setEntries] = useState(null); // null=loading, obj=loaded
  const [showCompleted, setShowCompleted] = useState(false);
  const pvTaskFilter = taskFilter;
  const setPvTaskFilter = setTaskFilter;
  const [editingEntry, setEditingEntry] = useState(null); // {date,lineIndex,text}
  const [editingTask, setEditingTask]   = useState(null); // {date,id,text}
  const [editingDesc, setEditingDesc]   = useState(false);
  const [descVal, setDescVal]           = useState('');
  const descRef = useRef(null);

  // Per-project collapse state (persisted)
  const [tasksCollapsed,   toggleTasks]   = useCollapse(`pv:${project}:tasks`,   false);
  const [entriesCollapsed, toggleEntries] = useCollapse(`pv:${project}:entries`, false);

  const meta = useMemo(() => ((projectsMeta || {})[project] || {}), [projectsMeta, project]);

  // Load entries when project changes
  useEffect(() => {
    if (!token || !project) return;
    setEntries(null);
    fetch(`/api/project-entries?project=${encodeURIComponent(project)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.error) { setEntries({ journalEntries: [], taskEntries: [] }); return; }
        // Auto-delete project if it has no entries anywhere (skip for Everything)
        if (!d.isEverything && !d.journalEntries?.length && !d.taskEntries?.length) {
          const updated = { ...(projectsMeta || {}) };
          delete updated[project];
          setProjectsMeta(updated, { skipHistory: true });
          onBack();
          return;
        }
        setEntries(d);
      })
      .catch(() => setEntries({ journalEntries: [], taskEntries: [] }));
  }, [project, token]); // eslint-disable-line

  // Group journal entries by date (oldest first)
  const journalByDate = useMemo(() => {
    if (!entries?.journalEntries?.length) return [];
    const map = {};
    entries.journalEntries.forEach(e => {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const taskEntries = entries?.taskEntries || [];
  const openTasks = taskEntries.filter(t => !t.done);
  const doneTasks = taskEntries.filter(t => t.done);

  // Group tasks by date (oldest first)
  const tasksByDate = useMemo(() => {
    if (!taskEntries.length) return [];
    const map = {};
    // Preserve DB order — do NOT split into open/done (that causes reorder on toggle)
    taskEntries.forEach(t => {
      if (!map[t.date]) map[t.date] = { all: [], open: [], done: [] };
      map[t.date].all.push(t);
      if (t.done) map[t.date].done.push(t);
      else map[t.date].open.push(t);
    });
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b));
  }, [taskEntries]);

  // Register any new tags found in edited text into projectsMeta
  function registerNewTags(text) {
    const tags = extractTags(text);
    if (!tags.length) return;
    const meta = projectsMeta || {};
    const newTags = tags.filter(t => !meta[t]);
    if (!newTags.length) return;
    const updated = { ...meta };
    newTags.forEach(t => { updated[t] = { description: '', createdAt: new Date().toISOString() }; });
    setProjectsMeta(updated, { skipHistory: true });
  }

  async function saveJournalEdit(date, lineIndex, newText) {
    const current = await dbLoad(date, 'notes', token);
    if (current === null) return;
    const lines = (current || '').split('\n');
    lines[lineIndex] = newText;
    const updated = lines.join('\n');
    await dbSave(date, 'notes', updated, token);
    // Update module-level cache so daily view reflects immediately
    MEM[`${userId}:${date}:notes`] = updated;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['notes'] } }));
    registerNewTags(newText);
    setEntries(prev => prev ? {
      ...prev,
      journalEntries: prev.journalEntries.map(e =>
        (e.date === date && e.lineIndex === lineIndex) ? { ...e, text: newText } : e
      ),
    } : prev);
  }

  async function toggleTask(date, taskId, currentDone) {
    const current = await dbLoad(date, 'tasks', token);
    if (!Array.isArray(current)) return;
    const updated = current.map(t => t.id === taskId ? { ...t, done: !currentDone } : t);
    await dbSave(date, 'tasks', updated, token);
    MEM[`${userId}:${date}:tasks`] = updated;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['tasks'] } }));
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: prev.taskEntries.map(t =>
        (t.date === date && t.id === taskId) ? { ...t, done: !currentDone } : t
      ),
    } : prev);
  }

  async function saveTaskEdit(date, taskId, newText) {
    const current = await dbLoad(date, 'tasks', token);
    if (!Array.isArray(current)) return;
    const updated = current.map(t => t.id === taskId ? { ...t, text: newText } : t);
    await dbSave(date, 'tasks', updated, token);
    MEM[`${userId}:${date}:tasks`] = updated;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['tasks'] } }));
    registerNewTags(newText);
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: prev.taskEntries.map(t =>
        (t.date === date && t.id === taskId) ? { ...t, text: newText } : t
      ),
    } : prev);
  }

  // Add a brand-new task to today's date with the project tag appended
  async function addNewTask(text) {
    if (!text.trim() || project === '__everything__') return;
    const today = todayKey(); // local date — avoids UTC midnight mismatch with day view
    const taskText = text.trim().endsWith(`#${project}`)
      ? text.trim()
      : `${text.trim()} #${project}`;
    const current = await dbLoad(today, 'tasks', token);
    const existing = Array.isArray(current) ? current : [];
    const newTask = { id: crypto.randomUUID(), text: taskText, done: false };
    const updated = [...existing, newTask];
    await dbSave(today, 'tasks', updated, token);
    const cacheKey = `${userId}:${today}:tasks`;
    MEM[cacheKey] = updated;
    // Notify day-view Tasks hook directly so it shows without re-fetching
    window.dispatchEvent(new CustomEvent('lifeos:mem-update', { detail: { key: cacheKey, value: updated } }));
    registerNewTags(taskText);
    // Append to local project-view entries so it appears immediately here too
    setEntries(prev => prev ? {
      ...prev,
      taskEntries: [...(prev.taskEntries || []), { date: today, id: newTask.id, text: taskText, done: false }],
    } : prev);
  }

  async function addNewJournal(text) {
    if (!text.trim() || project === '__everything__') return;
    const today = todayKey();
    const entryText = text.trim().endsWith(`#${project}`)
      ? text.trim()
      : `${text.trim()} #${project}`;
    const current = await dbLoad(today, 'notes', token);
    const existing = (typeof current === 'string' ? current : '') || '';
    const updated = existing ? existing.trimEnd() + '\n' + entryText : entryText;
    const newLineIndex = updated.split('\n').lastIndexOf(entryText);
    await dbSave(today, 'notes', updated, token);
    MEM[`${userId}:${today}:notes`] = updated;
    window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: { types: ['notes'] } }));
    registerNewTags(entryText);
    setEntries(prev => prev ? {
      ...prev,
      journalEntries: [...(prev.journalEntries || []), { date: today, lineIndex: newLineIndex, text: entryText }],
    } : prev);
  }

  const loadingCards = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Shimmer width="80%" height={13}/><Shimmer width="65%" height={13}/><Shimmer width="72%" height={13}/>
    </div>
  );

  const _pcol = project === '__everything__' ? C.accent : projectColor(project);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 10, paddingTop: 6, paddingBottom: 200 }}>

      {/* Description — bare on background, no card chrome */}
      {project === '__everything__' ? null : (
        <div style={{ padding: '0 4px' }}>
          {editingDesc ? (
            <textarea
              ref={descRef}
              value={descVal}
              onChange={e => { setDescVal(e.target.value); e.target.style.height='auto'; e.target.style.height=e.target.scrollHeight+'px'; }}
              onBlur={() => {
                setEditingDesc(false);
                const updated = { ...(projectsMeta || {}), [project]: { ...meta, description: descVal } };
                setProjectsMeta(updated, { skipHistory: true });
              }}
              onKeyDown={e => { if (e.key === 'Escape') e.target.blur(); }}
              onPaste={async e => {
                const items = e.clipboardData?.items;
                if (!items) return;
                for (const item of items) {
                  if (item.type.startsWith('image/')) {
                    e.preventDefault();
                    const file = item.getAsFile();
                    if (!file) continue;
                    const url = await uploadImageFile(file, token);
                    if (!url) continue;
                    const ta = descRef.current;
                    const pos = ta.selectionStart;
                    const marker = `\n[img:${url}]\n`;
                    const next = descVal.slice(0, pos) + marker + descVal.slice(pos);
                    setDescVal(next);
                    requestAnimationFrame(() => { ta.style.height='auto'; ta.style.height=ta.scrollHeight+'px'; });
                    break;
                  }
                }
              }}
              onDrop={async e => {
                const files = Array.from(e.dataTransfer?.files||[]).filter(f=>f.type.startsWith('image/'));
                if (!files.length) return;
                e.preventDefault();
                const url = await uploadImageFile(files[0], token);
                if (!url) return;
                const marker = `\n[img:${url}]\n`;
                setDescVal(v => v + marker);
                setTimeout(() => { const ta=descRef.current; if(ta){ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';} }, 50);
              }}
              onDragOver={e => e.preventDefault()}
              style={{
                width: '100%', border: 'none', outline: 'none', background: 'transparent',
                color: C.text, fontFamily: serif, fontSize: F.md, lineHeight: '1.7',
                resize: 'none', minHeight: 40, padding: 0, caretColor: C.accent,
              }}
            />
          ) : (
            <div
              style={{
                cursor: 'text', fontFamily: serif, fontSize: F.md, lineHeight: '1.7',
                color: meta.description ? C.text : C.dim,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}
              onClick={() => {
                setDescVal(meta.description || '');
                setEditingDesc(true);
                setTimeout(() => {
                  if (descRef.current) {
                    descRef.current.focus();
                    descRef.current.style.height = 'auto';
                    descRef.current.style.height = descRef.current.scrollHeight + 'px';
                  }
                }, 10);
              }}
            >
              {meta.description
                ? meta.description.split('\n').map((line, i) => {
                    const imgM = line.match(/^\[img:([^\]]+)\]$/);
                    if (imgM) return <div key={i} style={{margin:'4px 0',lineHeight:0}}><img src={imgM[1]} alt="" style={{maxWidth:'100%',maxHeight:320,borderRadius:8,display:'block'}}/></div>;
                    return <div key={i} style={{lineHeight:'1.7'}}>{renderRichLine(line)}</div>;
                  })
                : 'Add a project description…'
              }
            </div>
          )}
        </div>
      )}

      {/* Tasks — grouped by date with separators */}
      <Widget
        label={taskEntries.length ? `Tasks · ${openTasks.length} open` : 'Tasks'}
        color={C.blue} autoHeight
        collapsed={tasksCollapsed} onToggle={toggleTasks}
        headerRight={<TaskFilterBtns filter={pvTaskFilter} setFilter={setPvTaskFilter}/>}
      >
        {entries === null ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Shimmer width="70%" height={13}/><Shimmer width="55%" height={13}/>
          </div>
        ) : taskEntries.length === 0 ? (
          project === '__everything__' ? (
            <div style={{ fontFamily: mono, fontSize: F.sm, color: C.dim }}>No tasks yet.</div>
          ) : (
            <NewProjectTask project={project} onAdd={addNewTask} />
          )
        ) : (() => {
          const todayStr = todayKey();
          const otherDates = tasksByDate.filter(([d]) => d !== todayStr).sort(([a],[b]) => b.localeCompare(a));
          const todayEntry = tasksByDate.find(([d]) => d === todayStr);
          const allDates = todayEntry
            ? [[todayStr, todayEntry[1]], ...otherDates]
            : [[todayStr, { all:[], open:[], done:[] }], ...otherDates];

          function renderTaskRow(task) {
            return (
              <div key={task.id} style={{
                display:'flex', alignItems:'flex-start', gap:10, padding:'3px 0',
                opacity: task.done ? 0.35 : 1, transition: 'opacity 0.2s',
              }}>
                <button onClick={() => toggleTask(task.date, task.id, task.done)} style={{
                  width:15, height:15, flexShrink:0, borderRadius:4, padding:0, cursor:'pointer', marginTop:4,
                  border:`1.5px solid ${task.done ? C.accent : C.border2}`,
                  background: task.done ? C.accent : 'transparent',
                  display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s',
                }}>{task.done && <span style={{ fontSize:12, color:C.bg, lineHeight:1 }}>✓</span>}</button>
                {editingTask?.date === task.date && editingTask?.id === task.id ? (
                  <input autoFocus value={editingTask.text}
                    onChange={e => setEditingTask(prev => ({...prev, text: e.target.value}))}
                    onBlur={async () => { await saveTaskEdit(task.date, task.id, editingTask.text); setEditingTask(null); }}
                    onKeyDown={e => { if (e.key==='Enter'||e.key==='Escape') e.target.blur(); }}
                    style={{ background:'transparent', border:'none', outline:'none', padding:0, flex:1, lineHeight:'1.7',
                      color: task.done ? C.muted : C.text, caretColor:C.accent, fontFamily:serif, fontSize:F.md,
                      textDecoration: task.done ? 'line-through' : 'none' }}
                  />
                ) : (
                  <div onClick={() => setEditingTask({ date:task.date, id:task.id, text:task.text })}
                    style={{ flex:1, fontFamily:serif, fontSize:F.md, lineHeight:'1.7',
                      color: task.done ? C.muted : C.text, cursor:'text',
                      textDecoration: task.done ? 'line-through' : 'none',
                      whiteSpace:'pre-wrap', wordBreak:'break-word' }}>
                    {renderRichLine(task.text, project==='__everything__' ? null : project)}
                  </div>
                )}
              </div>
            );
          }

          return (
            <div>
              {allDates.filter(([date, { open, done }]) =>
                pvTaskFilter === 'open' ? (open.length > 0 || date === todayStr) :
                pvTaskFilter === 'done' ? (done.length > 0 || date === todayStr) : true
              ).map(([date, { all }], dateIdx) => {
                const isToday = date === todayStr;
                const filtered = all.filter(t =>
                  pvTaskFilter === 'open' ? !t.done :
                  pvTaskFilter === 'done' ? t.done : true
                );
                return (
                  <div key={date}>
                    <div style={{ display:'flex', alignItems:'center', gap:8,
                      marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 6 }}>
                      <div
                        onClick={() => !isToday && onSelectDate && (onBack(), onSelectDate(date))}
                        style={{
                          fontFamily: mono, fontSize: 10,
                          color: isToday ? C.accent : C.muted,
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                          cursor: (!isToday && onSelectDate) ? 'pointer' : 'default',
                          display: 'inline-block', transition: 'color 0.15s',
                        }}
                        onMouseEnter={e => { if (!isToday && onSelectDate) e.currentTarget.style.color = C.text; }}
                        onMouseLeave={e => { if (!isToday && onSelectDate) e.currentTarget.style.color = isToday ? C.accent : C.muted; }}
                      >{isToday ? 'Today' : fmtDate(date)}</div>
                    </div>
                    {isToday && project !== '__everything__' && pvTaskFilter !== 'done' && (
                      <NewProjectTask project={project} onAdd={addNewTask} />
                    )}
                    {filtered.map(task => renderTaskRow(task))}
                    <div style={{ borderTop:`1px solid ${C.border}`, marginTop:12, marginBottom:4 }}/>
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Widget>

      {/* Journal Entries */}
      <Widget
        label={entries?.journalEntries?.length
          ? (project === '__everything__' ? `ALL ENTRIES · ${entries.journalEntries.length}` : `Entries · ${entries.journalEntries.length}`)
          : (project === '__everything__' ? 'ALL ENTRIES' : 'Entries')}
        color={C.accent} autoHeight
        collapsed={entriesCollapsed} onToggle={toggleEntries}
        headerLeft={null}
      >
        {entries === null ? loadingCards
          : (() => {
            const today = todayKey();
            const otherDates = journalByDate.filter(([d]) => d !== today);
            const todayLines = journalByDate.find(([d]) => d === today)?.[1] || [];
            const allDates = [[today, todayLines], ...otherDates];

            function renderLines(date, lines) {
              const blocks = [];
              let cur = [];
              lines.forEach((entry, i) => {
                if (i === 0 || entry.lineIndex === lines[i-1].lineIndex + 1) cur.push(entry);
                else { if (cur.length) blocks.push(cur); cur = [entry]; }
              });
              if (cur.length) blocks.push(cur);
              return blocks.map((block, bi) => (
                <div key={bi} style={{ display:'flex', flexDirection:'column', gap:0 }}>
                  {block.map(entry => (
                    <EntryLine
                      key={`${date}-${entry.lineIndex}`}
                      entry={entry} date={date}
                      editing={editingEntry?.date === date && editingEntry?.lineIndex === entry.lineIndex}
                      onStartEdit={() => setEditingEntry({ date, lineIndex: entry.lineIndex, text: entry.text })}
                      onSave={async (text) => { await saveJournalEdit(date, entry.lineIndex, text); setEditingEntry(null); }}
                      dimTag={project === '__everything__' ? null : project}
                    />
                  ))}
                </div>
              ));
            }

            return (
              <div style={{ display:'flex', flexDirection:'column' }}>
                {allDates.map(([date, lines], dateIdx) => {
                  const isToday = date === today;
                  if (!isToday && lines.length === 0) return null;
                  return (
                    <div key={date}>
                      <div style={{
                        fontFamily: mono, fontSize: 10,
                        color: isToday ? C.accent : C.muted,
                        letterSpacing: '0.06em', textTransform: 'uppercase',
                        marginTop: dateIdx === 0 ? 0 : 4, marginBottom: 8,
                      }}>{isToday ? 'Today' : fmtDate(date)}</div>
                      {isToday && project !== '__everything__' && (
                        <AddJournalLine project={project} onAdd={addNewJournal} />
                      )}
                      <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                        {renderLines(date, lines)}
                      </div>
                      <div style={{ borderTop:`1px solid ${C.border}`, marginTop:16, marginBottom:4 }}/>
                    </div>
                  );
                })}
              </div>
            );
          })()
        }
      </Widget>
    </div>
  );
}

const MEALS_HDR = <span style={{display:"flex",gap:0}}><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:50,textAlign:"center"}}>prot</span><span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:72,textAlign:"center"}}>energy</span></span>;
const ACT_HDR = <span style={{display:"flex",gap:0}}>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:60,textAlign:"center"}}>dist</span>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:100,textAlign:"center"}}>pace</span>
  <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:"0.06em",textTransform:"uppercase",color:C.dim,width:72,textAlign:"center"}}>energy</span>
</span>;
const WIDGETS = [
  {id:"notes",    label:"Journal",  color:()=>C.accent, Comp:Notes},
  {id:"tasks",    label:"Tasks",    color:()=>C.blue,   Comp:Tasks},
  {id:"meals",    label:"Meals",    color:()=>C.red,    Comp:Meals,    headerRight:()=>MEALS_HDR},
  {id:"activity", label:"Activity", color:()=>C.green,  Comp:Activity, headerRight:()=>ACT_HDR},
];
const FULL_IDS = ["cal","health"];

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("theme") || "dark";
    return "dark";
  });
  // Set C globally before any render
  C = THEMES[theme] || THEMES.dark;

  const [session,   setSession]   = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [selected,  setSelected]  = useState(todayKey);
  const [calView,   setCalView]   = useState(() => localStorage.getItem('calView') || 'day');
  const [events,    setEvents]    = useState({});
  const [healthDots,setHealthDots]= useState({});
  const [syncing,   setSyncing]   = useState(new Set());
  const [lastSync,  setLastSync]  = useState(null);
  const [googleToken,setGoogleToken] = useState(null);
  const [stravaConnected, setStravaConnected] = useState(false);
  const [activeProject, setActiveProject] = useState(null); // null = daily view, string = project name
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef(null);


  useEffect(()=>{
    localStorage.setItem("theme", theme);
    C = THEMES[theme] || THEMES.dark;
    // Apply bg to document so html/body are correct color, not just the React root
    document.documentElement.style.background = C.bg;
    document.body.style.background = C.bg;
    document.documentElement.style.colorScheme = theme === "light" ? "light" : "dark";
  },[theme]);

  useEffect(injectBlurWebFont, []);



  useEffect(()=>{
    const supabase=createClient();
    const code=new URLSearchParams(window.location.search).get("code");
    if(code){supabase.auth.exchangeCodeForSession(code).then(()=>window.history.replaceState({},document.title,window.location.pathname));}
    supabase.auth.getSession().then(({data:{session}})=>{
      clearCacheForUser(session?.user?.id ?? null);
      setSession(session);setAuthReady(true);
    });
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_,s)=>{
      clearCacheForUser(s?.user?.id ?? null);
      setSession(s);setAuthReady(true);
    });
    return ()=>subscription.unsubscribe();
  },[]);

  const token=session?.access_token;
  const userId=session?.user?.id ?? null;

  // Graph data — declared HERE so token is already defined (avoids TDZ in minified bundle)
  const [graphData, setGraphData] = useState(null);
  useEffect(() => {
    if (activeProject !== '__graph__' || !token) return;
    if (graphData) return;
    Promise.all([
      fetch('/api/all-tags', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
      fetch('/api/tag-connections', { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json()),
    ]).then(function(res) {
      setGraphData({
        allTags: Array.isArray(res[0].tags) ? res[0].tags : [],
        connections: Array.isArray(res[1].connections) ? res[1].connections : [],
        recency: res[1].recency || {},
      });
    }).catch(function() { setGraphData({ allTags: [], connections: [], recency: {} }); });
  }, [activeProject, token]); // eslint-disable-line
  const { results: srResults, loading: srLoading } = useSearch(searchQuery, token, userId);

  // Expose token to native iOS layer (Swift reads this for HealthKit sync)
  // @supabase/ssr uses cookies not localStorage, so we bridge it manually
  useEffect(()=>{
    if(token) localStorage.setItem('daylab:token', token);
    else localStorage.removeItem('daylab:token');
  },[token]);

  useEffect(() => { localStorage.setItem('calView', calView); }, [calView]);

  // ── Auto-sync Oura on app open + visibility restore ────────────────────
  // Oura ring syncs to Oura servers automatically — we just need to fetch it.
  // Bust the module-level cache for today so HealthStrip re-fetches immediately.
  const bustTodayCacheAndSync = useCallback(() => {
    if (!token || !userId) return;
    const today = todayKey();
    // Remove today's entry from the module-level Oura cache so next render re-fetches
    const k = `${userId}|${today}`;
    delete _ouraCache[k];
    // Also evict today's health entry from the in-memory DB cache so useDbSave
    // re-fetches from Supabase after the fresh Oura write lands
    const healthKey = `${userId}:${today}:health`;
    delete MEM[healthKey];
    delete DIRTY[healthKey];
  }, [token, userId]);

  // Bust on mount (app open) and whenever window becomes visible again (return from background)
  useEffect(() => {
    if (!token || !userId) return;
    bustTodayCacheAndSync(); // immediate on mount
    const onVis = () => { if (!document.hidden) bustTodayCacheAndSync(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [token, userId, bustTodayCacheAndSync]); // eslint-disable-line

  // ── Silent background scores backfill — runs once per session ──────────
  // Finds any health/health_apple rows that don't have a computed scores entry
  // and fills them in. This is what populates historical trend data.
  useEffect(() => {
    if (!token || !userId) return;
    const key = `scores_backfill_done:${userId}`;
    if (sessionStorage.getItem(key)) return; // already ran this session
    sessionStorage.setItem(key, '1');
    fetch('/api/scores-backfill', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
      .then(r => r.json())
      .then(d => { if (d.scored > 0) console.log(`[daylab] backfilled ${d.scored} score entries`); })
      .catch(() => {}); // silent — never block the UI
  }, [token, userId]); // eslint-disable-line

  // ── Pull-to-refresh from native iOS app ────────────────────────────────
  useEffect(() => {
    const handler = () => {
      setSelected(todayKey());
      window.dispatchEvent(new CustomEvent('lifeos:refresh', { detail: {} }));
    };
    window.addEventListener('daylabRefresh', handler);
    return () => window.removeEventListener('daylabRefresh', handler);
  }, []);

  // ── Collapse state ─────────────────────────────────────────────────────
  const [calCollapsed,    toggleCal]      = useCollapse("cal",     false);
  const [healthCollapsed, toggleHealth]   = useCollapse("health",  true);
  const [notesCollapsed,  toggleNotes]    = useCollapse("notes",   false);
  const [tasksCollapsed,  toggleTasks]    = useCollapse("tasks",   false);
  const [taskFilter, setTaskFilter] = useState('all');
  const [mealsCollapsed,  toggleMeals]    = useCollapse("meals",   false);
  const [actCollapsed,    toggleAct]      = useCollapse("activity",false);
  const collapseMap = {notes:notesCollapsed,tasks:tasksCollapsed,meals:mealsCollapsed,activity:actCollapsed};
  const toggleMap   = {notes:toggleNotes,  tasks:toggleTasks,  meals:toggleMeals,  activity:toggleAct};

  // ── Global undo/redo keyboard shortcut ──────────────────────────────────
  useEffect(() => {
    const handler = async (e) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key !== 'z') return;
      // Don't fire when typing inside an input/textarea
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.preventDefault();
      if (e.shiftKey) { await doRedo(); }
      else            { await doUndo(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const sessionGoogleToken=session?.provider_token; // only present right after login
  const sessionRefreshToken=session?.provider_refresh_token; // only present right after login
  const startSync=useCallback(k=>setSyncing(s=>new Set([...s,k])),[]);
  const endSync=useCallback(k=>{
    setSyncing(s=>{const n=new Set(s);n.delete(k);return n;});
    setLastSync(new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}));
  },[]);

  // sessionGoogleToken/refreshToken only used by calendar fetch now

  // Fetch calendar events — server handles token refresh automatically
  const calRefreshRef = useRef(null);
  const fetchCalRef = useRef(null);

  // Re-fetch calendar when AI entry adds an event
  useEffect(()=>{
    const handler = (e) => {
      if (e.detail?.types?.includes('calendar') && fetchCalRef.current) {
        fetchCalRef.current();
      }
    };
    window.addEventListener('lifeos:refresh', handler);
    return ()=>window.removeEventListener('lifeos:refresh', handler);
  }, []);
  useEffect(()=>{
    if(!token)return;
    startSync("cal");
    const tz=Intl.DateTimeFormat().resolvedOptions().timeZone;
    const start=toKey(shift(new Date(),-30));
    const end=toKey(shift(new Date(),60));

    const fetchCal=()=>fetch("/api/calendar",{method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify({start,end,tz})})
      .then(r=>r.ok?r.json():null)
      .then(d=>{
        if(d?.events) setEvents(prev=>({...prev,...d.events}));
        if(d?.googleToken) setGoogleToken(d.googleToken);
      })
      .catch(()=>{})
      .finally(()=>endSync("cal"));

    fetchCalRef.current = fetchCal;

    // On fresh login, save the provider token first, then fetch
    if(sessionGoogleToken){
      fetch("/api/google-token",{method:"POST",
        headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
        body:JSON.stringify({googleToken:sessionGoogleToken,refreshToken:sessionRefreshToken})})
        .then(()=>fetchCal()).catch(()=>fetchCal());
    } else {
      fetchCal();
    }

    // Re-fetch every 45 min to keep events fresh
    calRefreshRef.current = setInterval(fetchCal, 45*60*1000);
    return ()=>{ if(calRefreshRef.current) clearInterval(calRefreshRef.current); };
  },[token]); // eslint-disable-line

  // onHealthChange: called when raw health data loads — kept as prop, used for InsightsCard healthKey.
  const onHealthChange=useCallback(()=>{},[]);

  // onScoresReady: called by HealthStrip when /api/scores returns fresh computed scores.
  // Updates the calendar dot for that specific date with correct values.
  const onScoresReady=useCallback((date, d)=>{
    setHealthDots(prev=>({...prev,[date]:{
      sleep:    d.sleep?.score    ?? prev[date]?.sleep    ?? 0,
      readiness:d.readiness?.score?? prev[date]?.readiness?? 0,
      activity: d.activity?.score ?? prev[date]?.activity ?? 0,
      recovery: d.recovery?.score ?? prev[date]?.recovery ?? 0,
    }}));
  },[]);

  // Load health dots from computed scores only (type='scores').
  // Backfill now computes our own scores for all historical dates,
  // so we never fall back to Oura's scoring system.
  useEffect(()=>{
    if(!token||!userId)return;
    const supabase=createClient();
    supabase.auth.setSession({access_token:token,refresh_token:''});
    const since=toKey(shift(new Date(),-180));
    const dotsToday = todayKey();
    supabase.from('entries').select('date,data')
      .eq('user_id',userId).eq('type','scores').gte('date',since).lte('date',dotsToday)
      .then(({data})=>{
        if(!data)return;
        const dots={};
        data.forEach(row=>{
          if(!row.date||!row.data)return;
          dots[row.date]={
            sleep:    +row.data.sleepScore    ||0,
            readiness:+row.data.readinessScore||0,
            activity: +row.data.activityScore ||0,
            recovery: +row.data.recoveryScore ||0,
          };
        });
        setHealthDots(dots);
      }).catch(()=>{});
  },[token,userId]); // eslint-disable-line

  const mobile = useIsMobile();
  if(!authReady) return (
    <div style={{background:C.bg,height:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <span style={{fontFamily:mono,fontSize:F.sm,color:C.muted,letterSpacing:"0.2em"}}>loading…</span>
    </div>
  );
  if(!session) return <LoginScreen/>;

  const syncStatus={syncing:syncing.size>0,lastSync};
  const [leftWidget,...rightWidgets] = WIDGETS;

  return (
    <div style={{background:C.bg,height:"100vh",color:C.text,display:"flex",flexDirection:"column",overflowY:mobile?"auto":"hidden"}}>
      <style>{`
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0;}
        html,body{height:100%;overflow:hidden;background:${C.bg} !important;}
        @media(max-width:768px){html,body{overflow:hidden;height:100%;}}
        ::-webkit-scrollbar{display:none;}
        *{scrollbar-width:none;-ms-overflow-style:none;}
        button{border-radius:0;}
        input::placeholder,textarea::placeholder{color:${C.dim};opacity:1;}
        [contenteditable][data-placeholder]:empty::before{content:attr(data-placeholder);color:${C.dim};pointer-events:none;}
        .oura-token-input::placeholder{color:${C.dim};opacity:1;}
        a{text-decoration:none;}
        @media(max-width:768px){input,textarea,select{font-size:16px;}}
        @keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeInUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      <TopBar session={session} token={token} userId={userId} syncStatus={syncStatus} theme={theme} onThemeChange={setTheme} selected={selected} onGoToToday={()=>setSelected(todayKey())} stravaConnected={stravaConnected} onStravaChange={setStravaConnected}/>

      {/* Vignette — short soft fade just below the TopBar */}
      <div style={{
        position:"fixed", top:"calc(env(safe-area-inset-top, 0px) + 58px)", left:0, right:0,
        height:48, pointerEvents:"none", zIndex:50,
        background:`linear-gradient(to bottom, ${C.bg} 0%, transparent 100%)`,
      }}/>


      {/* ── SINGLE layout path — stacks on narrow, 2-col on wide ─── */}
        <div style={{flex:1, minHeight:0, overflowY:activeProject?"hidden":mobile?"auto":"auto", display:"flex", flexDirection:"column", alignItems:"stretch", paddingTop:0}}>
        <div style={{
          flex:1, minHeight:0, maxWidth:1200, width:"100%", margin:"0 auto", alignSelf:"stretch",
          overflowY:activeProject?"hidden":mobile?"auto":"auto",
          padding:activeProject?0:mobile?"6px 8px":10,
          paddingTop:activeProject?0:52,
          paddingBottom:activeProject?0:mobile?200:0, display:"flex", flexDirection:"column", gap:activeProject?0:mobile?10:8}}>

          {/* Calendar + Health + Search — hidden in project view */}
          {!activeProject && (() => {
            return (
              <>
                {/* ── Projects strip ↔ Search pill (crossfade) ── */}
                <div style={{ position: 'relative', flexShrink: 0, height: 52, overflow: 'visible' }}>
                  {/* Projects bar — fades out when search open */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    opacity: searchOpen ? 0 : 1,
                    pointerEvents: searchOpen ? 'none' : 'auto',
                    transition: 'opacity 0.18s ease',
                    display: 'flex', alignItems: 'center',
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <ProjectsCard date={selected} token={token} userId={userId} onSelectProject={setActiveProject}/>
                    </div>
                    <button
                      onClick={() => {
                        setSearchOpen(true);
                        setTimeout(() => searchInputRef.current?.focus(), 60);
                      }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '8px 12px', display: 'flex', alignItems: 'center',
                        color: C.muted, flexShrink: 0, transition: 'color 0.15s',
                        minWidth: 44, minHeight: 44, justifyContent: 'center',
                      }}
                      onMouseEnter={e => e.currentTarget.style.color = C.text}
                      onMouseLeave={e => e.currentTarget.style.color = C.muted}
                      aria-label="Search"
                    >
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                    </button>
                  </div>

                  {/* Search pill — fades in when search open */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    opacity: searchOpen ? 1 : 0,
                    pointerEvents: searchOpen ? 'auto' : 'none',
                    transition: 'opacity 0.18s ease',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '0 10px',
                  }}>
                    <div style={{
                      width: '100%', maxWidth: 560,
                      display: 'flex', alignItems: 'center', gap: 8,
                      backdropFilter: 'blur(20px) saturate(1.4)',
                      WebkitBackdropFilter: 'blur(20px) saturate(1.4)',
                      background: `${C.surface}ee`,
                      border: `1px solid ${C.border}`,
                      borderRadius: 100,
                      padding: '0 18px',
                      height: 52,
                      boxShadow: C.shadow,
                    }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={C.muted} strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        ref={searchInputRef}
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); }
                        }}
                        placeholder="Search"
                        style={{
                          flex: 1, background: 'transparent', border: 'none', outline: 'none',
                          fontFamily: serif, fontSize: F.md, color: C.text, caretColor: C.accent,
                        }}
                      />
                      {srLoading && (
                        <span style={{ fontFamily: mono, fontSize: 8, color: C.muted, letterSpacing: '0.12em', flexShrink: 0 }}>…</span>
                      )}
                      <button
                        onClick={() => { setSearchOpen(false); setSearchQuery(''); }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px',
                          color: C.muted, display: 'flex', alignItems: 'center', flexShrink: 0,
                          transition: 'color 0.12s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.color = C.text}
                        onMouseLeave={e => e.currentTarget.style.color = C.muted}
                        aria-label="Close search"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Cal + Health — hidden during search */}
                {!searchOpen && (
                  <>
                    <div style={{flexShrink:0}}>
                      <CalStrip selected={selected} onSelect={setSelected}
                        events={events} setEvents={setEvents} healthDots={healthDots}
                        token={token} collapsed={calCollapsed} onToggle={toggleCal}
                        calView={calView} onCalViewChange={v=>{setCalView(v);}}/>
                    </div>
                    <div style={{flexShrink:0}}>
                      <HealthStrip date={selected} token={token} userId={userId}
                        onHealthChange={onHealthChange} onScoresReady={onScoresReady} onSyncStart={startSync} onSyncEnd={endSync}
                        collapsed={healthCollapsed} onToggle={toggleHealth}/>
                    </div>
                  </>
                )}
              </>
            );
          })()}

          {/* Project view OR daily widgets */}
          {activeProject ? (
            (() => {
              const isGraph  = activeProject === '__graph__';
              const isHealth = activeProject === '__health__';
              const pcol = isHealth ? C.green : isGraph ? C.accent : projectColor(activeProject);
              return (
                <>
                  {/* Fixed project header — outside scroll area */}
                  <div style={{flexShrink:0,display:'flex',alignItems:'center',gap:8,padding:'14px 14px 8px',background:C.bg}}>
                    <button
                      onClick={async () => setActiveProject(null)}
                      style={{background:'none',border:'none',cursor:'pointer',display:'flex',alignItems:'center',padding:'0 2px',color:pcol+'99',flexShrink:0}}
                      aria-label="Back"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <span style={{fontFamily:mono,fontSize:F.sm,letterSpacing:'0.08em',textTransform:'uppercase',color:pcol}}>
                      {isGraph ? 'ALL' : isHealth ? 'Health' : activeProject === '__everything__' ? 'ALL' : tagDisplayName(activeProject)}
                    </span>
                  </div>
                  {/* Scrollable content */}
                  <div style={{flex:1,minHeight:0,overflow:'auto'}}>
                    {/* Top vignette — matches daily view */}
                    {!isGraph && <div style={{position:'sticky',top:0,height:48,marginBottom:-48,
                      pointerEvents:'none',zIndex:10,
                      background:`linear-gradient(to bottom, ${C.bg} 0%, transparent 100%)`}}/>}
                    {isGraph ? (
                      graphData ? (
                        <ProjectGraphView
                          allTags={graphData.allTags}
                          connections={graphData.connections}
                          recency={graphData.recency}
                          onSelectProject={p => { if (p === '__graph__') return; setActiveProject(p); }}
                          onBack={() => setActiveProject(null)}
                        />
                      ) : (
                        <div style={{display:'flex',alignItems:'center',justifyContent:'center',height:'100%',
                          fontFamily:mono,fontSize:F.sm,color:C.dim}}>Loading graph…</div>
                      )
                    ) : isHealth ? (
                      <HealthProjectView
                        token={token} userId={userId}
                        onBack={() => setActiveProject(null)}
                        onHealthChange={onHealthChange}
                        onScoresReady={onScoresReady}
                        startSync={startSync}
                        endSync={endSync}
                        onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                        taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                      />
                    ) : (
                      <ProjectView
                        project={activeProject}
                        token={token}
                        userId={userId}
                        onBack={() => setActiveProject(null)}
                        onSelectDate={d => { setActiveProject(null); setSelected(d); }}
                        taskFilter={taskFilter} setTaskFilter={setTaskFilter}
                      />
                    )}
                  </div>
                </>
              );
            })()
          ) : searchOpen ? (
            /* ── Search results — replace widgets while searching ── */
            <div style={{ flex: 1, overflowY: 'auto', animation: 'fadeInUp 0.18s ease' }}>
              <SearchResults
                results={srResults}
                loading={srLoading}
                query={searchQuery}
                onSelectDate={d => { setSearchOpen(false); setSearchQuery(''); setSelected(d); }}
              />
            </div>
          ) : (
            <>
              {/* Widgets — row on wide, flat stack on narrow */}
              {mobile ? (
                <div style={{display:"flex", flexDirection:"column", gap:10, paddingBottom:200}}>
                  <Widget label={leftWidget.label} color={leftWidget.color()}
                    collapsed={collapseMap[leftWidget.id]}
                    onToggle={toggleMap[leftWidget.id]}
                    headerRight={leftWidget.headerRight?.()} autoHeight>
                    <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}/>
                  </Widget>
                  {rightWidgets.map(w=>(
                    <Widget key={w.id} label={w.label} color={w.color()}
                      collapsed={collapseMap[w.id]}
                      onToggle={toggleMap[w.id]}
                      headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()} autoHeight>
                      <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id==='tasks'?taskFilter:undefined}/>
                    </Widget>
                  ))}
                </div>
              ) : (
                <div style={{display:"flex", gap:10,
                  flexDirection:"row",
                  alignItems:"stretch"}}>

                  {/* Left column: Journal — stretches to match right col height */}
                  <div style={{flex:"1 1 0", minWidth:0,
                    display:"flex", flexDirection:"column", gap:10,
                    paddingBottom:180}}>
                    <div style={{flex:1, minHeight:320, display:"flex", flexDirection:"column"}}>
                      <Widget label={leftWidget.label} color={leftWidget.color()}
                        collapsed={collapseMap[leftWidget.id]}
                        onToggle={toggleMap[leftWidget.id]}
                        headerRight={leftWidget.headerRight?.()}>
                        <leftWidget.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected}/>
                      </Widget>
                    </div>
                  </div>

                  {/* Right widgets — column always; last card stretches to fill */}
                  <div style={{flex:"1 1 0", minWidth:0,
                    display:"flex", flexDirection:"column", gap:10,
                    paddingBottom:180}}>
                    {rightWidgets.map((w, i)=>(
                      <div key={w.id} style={{
                        display:"flex", flexDirection:"column",
                        flex: (!collapseMap[w.id] && i === rightWidgets.length - 1) ? 1 : "0 0 auto",
                        minHeight: collapseMap[w.id]?0:200}}>
                        <Widget label={w.label} color={w.color()}
                          collapsed={collapseMap[w.id]}
                          onToggle={toggleMap[w.id]}
                          headerRight={w.id==='tasks' ? <TaskFilterBtns filter={taskFilter} setFilter={setTaskFilter}/> : w.headerRight?.()}>
                          <w.Comp date={selected} token={token} userId={userId} stravaConnected={stravaConnected} taskFilter={w.id==='tasks'?taskFilter:undefined}/>
                        </Widget>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        </div>

      {/* Bottom vignette — fades content up into the AI bar */}
      <div style={{
        position:"fixed", bottom:0, left:0, right:0,
        height:120, pointerEvents:"none", zIndex:96,
        background:`linear-gradient(to top, ${C.bg} 0%, ${C.bg}99 35%, transparent 100%)`,
      }}/>

      {/* Floating chat pill — hidden during search */}
      {!searchOpen && (
        <ChatFloat date={selected} token={token} userId={userId} theme={theme}
          healthKey={`${selected}:${healthDots[selected]?.sleep||0}:${healthDots[selected]?.readiness||0}`}/>
      )}
    </div>
  );
}
