"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";
import { Card } from "../ui/primitives.jsx";
import { showToast } from "../ui/Toast.jsx";

// ── Design tokens ──────────────────────────────────────────────────────────────
const CARD_COLOR = "#B89ACD"; // lilac

const PALETTE = [
  '#1c1b18', // warm black
  '#888580', // warm gray
  '#c0392b', // red
  '#e07b39', // orange
  '#c9a227', // amber
  '#27ae60', // green
  '#2980b9', // blue
  '#8e44ad', // purple
  '#ffffff',  // white
];

const WIDTHS = [2, 5.5, 15]; // thin / medium / thick (logical px)

const DPR = () =>
  typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;

// ── Shape recognition ──────────────────────────────────────────────────────────
// After a brief pause at the end of a stroke, we check if it looks like a
// recognisable shape and snap it. Snapping replaces the freehand points with
// clean geometry but keeps all other stroke properties (color, width, tool).

function detectShape(pts) {
  if (pts.length < 5) return null;
  if (isLine(pts))    return { type: 'line' };
  if (isEllipse(pts)) return { type: 'ellipse', ...fitEllipse(pts) };
  return null;
}

function isLine(pts) {
  const p0 = pts[0], p1 = pts[pts.length - 1];
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy);
  if (len < 20) return false;
  const maxDev = pts.reduce((m, p) => {
    const t = Math.max(0, Math.min(1,
      ((p.x - p0.x) * dx + (p.y - p0.y) * dy) / (len * len)));
    return Math.max(m, Math.hypot(p.x - (p0.x + t * dx), p.y - (p0.y + t * dy)));
  }, 0);
  return maxDev / len < 0.10;
}

function isEllipse(pts) {
  const p0 = pts[0], pN = pts[pts.length - 1];
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const size = Math.max(w, h);
  if (size < 30) return false;
  if (Math.hypot(p0.x - pN.x, p0.y - pN.y) > size * 0.45) return false;
  const { cx, cy, rx, ry } = fitEllipse(pts);
  if (rx < 12 || ry < 12) return false;
  const maxErr = pts.reduce((m, p) => {
    const nx = (p.x - cx) / rx, ny = (p.y - cy) / ry;
    return Math.max(m, Math.abs(nx * nx + ny * ny - 1));
  }, 0);
  return maxErr < 0.65;
}

function fitEllipse(pts) {
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    rx: (maxX - minX) / 2,
    ry: (maxY - minY) / 2,
  };
}

// ── Canvas rendering ───────────────────────────────────────────────────────────
function drawStroke(ctx, stroke) {
  const { points: pts, tool, color, width, shape } = stroke;
  if (!pts?.length) return;

  ctx.save();
  const isErase = tool === 'eraser';
  if (isErase) ctx.globalCompositeOperation = 'destination-out';

  // Pressure-aware width: Apple Pencil gives 0–1, mouse/trackpad gives 0.5
  const avgP = pts.reduce((s, p) => s + (p.p ?? 0.5), 0) / pts.length;
  const lw   = width * Math.max(0.35, Math.min(1.8, avgP * 1.8));

  ctx.strokeStyle = isErase ? 'rgba(0,0,0,1)' : color;
  ctx.fillStyle   = isErase ? 'rgba(0,0,0,1)' : color;
  ctx.lineWidth   = lw;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';

  ctx.beginPath();

  if (shape?.type === 'line') {
    ctx.moveTo(pts[0].x, pts[0].y);
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  } else if (shape?.type === 'ellipse') {
    ctx.ellipse(shape.cx, shape.cy, shape.rx, shape.ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (pts.length === 1) {
    ctx.arc(pts[0].x, pts[0].y, lw / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smooth Catmull-Rom-style path through midpoints
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.stroke();
  }

  ctx.restore();
}

function redrawAll(ctx, strokes, w, h) {
  ctx.clearRect(0, 0, w, h);
  for (const s of strokes) drawStroke(ctx, s);
}

function makeThumbnail(strokes, srcW, srcH) {
  try {
    const TW = 120, TH = 90;
    const c   = document.createElement('canvas');
    c.width   = TW;
    c.height  = TH;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, TW, TH);
    const scale = Math.min(TW / srcW, TH / srcH);
    const ox    = (TW - srcW * scale) / 2;
    const oy    = (TH - srcH * scale) / 2;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    for (const s of strokes) drawStroke(ctx, s);
    ctx.restore();
    return c.toDataURL('image/png');
  } catch { return null; }
}

// ── Icons ──────────────────────────────────────────────────────────────────────
const PenIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9"/>
    <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
  </svg>
);

const EraserIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20H7L3 16l10-10 7 7-3.5 3.5"/>
    <path d="M6.5 17.5l4-4"/>
  </svg>
);

const UndoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 14 4 9 9 4"/>
    <path d="M20 20v-7a4 4 0 00-4-4H4"/>
  </svg>
);

const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/>
  </svg>
);

// ── DrawingCanvas ──────────────────────────────────────────────────────────────
// Self-contained canvas with toolbar. Tool/color/size state persists across
// drawing switches; only strokes reset when drawingId changes.

function DrawingCanvas({ drawingId, initialStrokes, onCommit }) {
  const canvasRef    = useRef(null);
  const containerRef = useRef(null);

  // Persistent tool state (survives drawing switches)
  const [tool,     setTool]     = useState('pen');
  const [colorIdx, setColorIdx] = useState(0);
  const [sizeIdx,  setSizeIdx]  = useState(1);

  // Stroke state — reset when drawingId changes
  const [strokes, setStrokes] = useState(initialStrokes || []);
  const strokesRef   = useRef(strokes);
  const curStrokeRef = useRef(null);     // stroke being drawn right now
  const activePenRef = useRef(false);    // true while Apple Pencil is the active pointer
  const shiftRef     = useRef(false);    // Shift key for straight lines
  const qsTimerRef   = useRef(null);     // QuickShape debounce timer

  const [logSize, setLogSize] = useState({ w: 600, h: 400 });
  const logSizeRef = useRef(logSize);

  // ── Reset strokes when switching drawings ────────────────────────────────────
  const prevIdRef = useRef(drawingId);
  useEffect(() => {
    if (drawingId === prevIdRef.current && strokes === initialStrokes) return;
    prevIdRef.current = drawingId;
    const s = initialStrokes || [];
    setStrokes(s);
    strokesRef.current = s;
    curStrokeRef.current = null;
    if (qsTimerRef.current) { clearTimeout(qsTimerRef.current); qsTimerRef.current = null; }
  }, [drawingId, initialStrokes]); // eslint-disable-line

  // ── Observe container for resize ────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      const s = { w: Math.max(60, Math.floor(width)), h: Math.max(60, Math.floor(height)) };
      logSizeRef.current = s;
      setLogSize(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Setup canvas dimensions when size changes ────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = DPR();
    const { w, h } = logSize;
    canvas.width        = w * dpr;
    canvas.height       = h * dpr;
    canvas.style.width  = w + 'px';
    canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawAll(ctx, strokesRef.current, w, h);
  }, [logSize]);

  // ── Redraw when strokes change externally (undo, drawing switch) ─────────────
  useEffect(() => {
    strokesRef.current = strokes;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { w, h } = logSizeRef.current;
    const dpr = DPR();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawAll(ctx, strokes, w, h);
  }, [strokes]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Shift') { shiftRef.current = true; return; }
      // Ignore if typing in an input
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' ||
          e.target.isContentEditable) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        setStrokes(prev => {
          const next = prev.slice(0, -1);
          strokesRef.current = next;
          return next;
        });
      }
    };
    const onKeyUp = (e) => { if (e.key === 'Shift') shiftRef.current = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, []);

  // ── Pointer helpers ──────────────────────────────────────────────────────────
  const getPos = useCallback((e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      p: e.pressure ?? 0.5,
    };
  }, []);

  // ── Pointer down ─────────────────────────────────────────────────────────────
  const onPointerDown = useCallback((e) => {
    // Palm rejection: once a pen is drawing, ignore fingers/mouse
    if (activePenRef.current && e.pointerType !== 'pen') return;
    if (e.pointerType === 'pen') activePenRef.current = true;

    e.preventDefault();
    try { canvasRef.current?.setPointerCapture(e.pointerId); } catch {}

    if (qsTimerRef.current) { clearTimeout(qsTimerRef.current); qsTimerRef.current = null; }

    const pos = getPos(e);
    curStrokeRef.current = {
      id:          `${Date.now()}-${Math.random()}`,
      tool,
      color:       PALETTE[colorIdx],
      width:       WIDTHS[sizeIdx],
      points:      [pos],
      shiftMode:   shiftRef.current,
      pointerType: e.pointerType,
    };
  }, [tool, colorIdx, sizeIdx, getPos]);

  // ── Pointer move ─────────────────────────────────────────────────────────────
  const onPointerMove = useCallback((e) => {
    const cur = curStrokeRef.current;
    if (!cur) return;
    // Only track the pointer type that started the stroke
    if (e.pointerType !== cur.pointerType) return;
    e.preventDefault();

    const pos = getPos(e);
    if (cur.shiftMode) {
      // Straight-line mode: keep only start + current endpoint
      cur.points = [cur.points[0], pos];
    } else {
      cur.points.push(pos);
    }

    // Incremental redraw: committed + current stroke
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    const dpr = DPR();
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redrawAll(ctx, strokesRef.current, w, h);
    drawStroke(ctx, cur);
  }, [getPos]);

  // ── Pointer up ───────────────────────────────────────────────────────────────
  const onPointerUp = useCallback((e) => {
    const cur = curStrokeRef.current;
    if (!cur) return;

    if (e.pointerType === 'pen') {
      setTimeout(() => { activePenRef.current = false; }, 300);
    }

    curStrokeRef.current = null;
    const finished = { ...cur, points: [...cur.points] };
    const next = [...strokesRef.current, finished];
    strokesRef.current = next;
    setStrokes(next);

    // QuickShape: wait 600 ms — if user hasn't started another stroke, snap it
    if (finished.tool === 'pen' && !finished.shiftMode && finished.points.length > 4) {
      qsTimerRef.current = setTimeout(() => {
        qsTimerRef.current = null;
        const shape = detectShape(finished.points);
        if (!shape) return;
        setStrokes(prev => {
          const updated = prev.map(s => s.id === finished.id ? { ...s, shape } : s);
          strokesRef.current = updated;
          // Redraw with snapped shape
          const canvas = canvasRef.current;
          if (canvas) {
            const { w, h } = logSizeRef.current;
            const dpr = DPR();
            const ctx = canvas.getContext('2d');
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            redrawAll(ctx, updated, w, h);
          }
          onCommit?.(updated, canvasRef.current, logSizeRef.current);
          return updated;
        });
      }, 600);
    }

    // Notify parent to debounce-save
    onCommit?.(next, canvasRef.current, logSizeRef.current);
  }, [onCommit]);

  const undo = useCallback(() => {
    if (qsTimerRef.current) { clearTimeout(qsTimerRef.current); qsTimerRef.current = null; }
    setStrokes(prev => {
      const next = prev.slice(0, -1);
      strokesRef.current = next;
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    if (qsTimerRef.current) { clearTimeout(qsTimerRef.current); qsTimerRef.current = null; }
    setStrokes([]);
    strokesRef.current = [];
    onCommit?.([], canvasRef.current, logSizeRef.current);
  }, [onCommit]);

  const color = PALETTE[colorIdx];
  const btnBase = {
    background: 'none', border: 'none', cursor: 'pointer',
    display: 'flex', alignItems: 'center', padding: '4px 6px',
    borderRadius: 6, transition: 'color 0.15s',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>

      {/* ── Toolbar ────────────────────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '7px 12px', borderBottom: '1px solid var(--dl-border)',
        flexShrink: 0, flexWrap: 'wrap', background: 'var(--dl-card)',
        userSelect: 'none',
      }}>

        {/* Pen / Eraser toggle */}
        <div style={{
          display: 'flex',
          background: 'var(--dl-border-15, rgba(128,120,100,0.1))',
          borderRadius: 100, padding: 2,
        }}>
          {[{ t: 'pen', Icon: PenIcon }, { t: 'eraser', Icon: EraserIcon }].map(({ t, Icon }) => (
            <button key={t} onClick={() => setTool(t)}
              style={{
                background: tool === t
                  ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
                border: 'none', borderRadius: 100, padding: '5px 9px', cursor: 'pointer',
                color: tool === t ? 'var(--dl-strong)' : 'var(--dl-middle)',
                display: 'flex', alignItems: 'center', transition: 'all 0.15s',
              }}>
              <Icon />
            </button>
          ))}
        </div>

        {/* Stroke size */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {WIDTHS.map((_, i) => (
            <button key={i} onClick={() => setSizeIdx(i)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3,
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{
                width:  5 + i * 5,
                height: 5 + i * 5,
                borderRadius: '50%',
                background: tool === 'eraser' ? 'var(--dl-middle)' : color,
                opacity: sizeIdx === i ? 1 : 0.28,
                transform: sizeIdx === i ? 'scale(1.25)' : 'scale(1)',
                transition: 'opacity 0.15s, transform 0.15s',
              }} />
            </button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: 'var(--dl-border)', flexShrink: 0 }} />

        {/* Color palette */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          {PALETTE.map((c, i) => {
            const active = colorIdx === i && tool === 'pen';
            return (
              <button key={c} onClick={() => { setColorIdx(i); setTool('pen'); }}
                style={{
                  width: 16, height: 16, borderRadius: '50%',
                  background: c, cursor: 'pointer', padding: 0, flexShrink: 0,
                  border: active ? '2px solid var(--dl-strong)'
                    : c === '#ffffff' ? '1.5px solid var(--dl-border)'
                    : '2px solid transparent',
                  boxShadow: active
                    ? '0 0 0 2px var(--dl-card), 0 0 0 3.5px var(--dl-strong)' : 'none',
                  transform: active ? 'scale(1.2)' : 'scale(1)',
                  transition: 'box-shadow 0.12s, transform 0.12s',
                }} />
            );
          })}
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 18, background: 'var(--dl-border)', flexShrink: 0 }} />

        {/* Undo */}
        <button onClick={undo} title="Undo (⌘Z)"
          style={{ ...btnBase, color: 'var(--dl-middle)' }}
          onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}>
          <UndoIcon />
        </button>

        {/* Clear */}
        <button onClick={clearAll} title="Clear canvas"
          style={{ ...btnBase, color: 'var(--dl-middle)' }}
          onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
          onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}>
          <TrashIcon />
        </button>

        {/* Shift hint */}
        <span style={{
          marginLeft: 'auto', fontFamily: mono, fontSize: 10,
          color: 'var(--dl-border)', letterSpacing: '0.04em',
          display: 'flex', gap: 8,
        }}>
          <span>⇧ straight</span>
          <span>hold→snap</span>
        </span>
      </div>

      {/* ── Canvas ─────────────────────────────────────────────────────────── */}
      <div ref={containerRef} style={{
        flex: 1, position: 'relative', background: '#ffffff',
        overflow: 'hidden', minHeight: 280, cursor: 'crosshair',
        borderRadius: '0 0 12px 12px',
      }}>
        <canvas
          ref={canvasRef}
          style={{ display: 'block', touchAction: 'none', userSelect: 'none', cursor: 'crosshair' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      </div>
    </div>
  );
}

// ── DrawingsCard ───────────────────────────────────────────────────────────────
// Selector strip (thumbnails) + full drawing canvas.
// Each drawing is a first-class object; the strip just filters to "all mine".

export default function DrawingsCard({ token, userId }) {
  const [list,         setList]         = useState([]);   // [{id, title, thumbnail}]
  const [activeId,     setActiveId]     = useState(null);
  const [activeStrokes,setActiveStrokes]= useState(null); // null = loading
  const [deleteConfirm,setDeleteConfirm]= useState(null);

  const saveTimerRef   = useRef(null);
  const pendingSaveRef = useRef(null);
  const onCommitRef    = useRef(null); // stable ref to latest onCommit

  // Load drawing list on mount
  useEffect(() => {
    if (!token) return;
    api.get('/api/drawings', token)
      .then(res => {
        const drawings = res?.drawings || [];
        setList(drawings);
        setActiveId(drawings[0]?.id ?? null);
      })
      .catch(() => showToast('Failed to load drawings', 'error'));
  }, [token]);

  // Load strokes when active drawing changes
  useEffect(() => {
    if (!activeId || !token) {
      setActiveStrokes(activeId ? null : []);
      return;
    }
    setActiveStrokes(null);
    api.get(`/api/drawings?id=${activeId}`, token)
      .then(res => setActiveStrokes(res?.drawing?.strokes || []))
      .catch(() => { showToast('Failed to load drawing', 'error'); setActiveStrokes([]); });
  }, [activeId, token]);

  // Create a new drawing
  const newDrawing = useCallback(async () => {
    if (!token) return;
    try {
      const res = await api.post('/api/drawings',
        { title: 'Untitled', strokes: [], thumbnail: null }, token);
      if (res?.drawing) {
        setList(prev => [res.drawing, ...prev]);
        setActiveId(res.drawing.id);
        setActiveStrokes([]);
      }
    } catch { showToast('Failed to create drawing', 'error'); }
  }, [token]);

  // Delete a drawing
  const deleteDrawing = useCallback(async (id) => {
    try {
      await api.delete(`/api/drawings?id=${id}`, token);
      setList(prev => {
        const next = prev.filter(d => d.id !== id);
        if (activeId === id) setActiveId(next[0]?.id ?? null);
        return next;
      });
    } catch { showToast('Failed to delete drawing', 'error'); }
  }, [activeId, token]);

  // Debounced save triggered by DrawingCanvas
  const handleCommit = useCallback((strokes, canvasEl, logSize) => {
    if (!activeId) return;

    // Update thumbnail in strip immediately so it feels snappy
    if (canvasEl && strokes.length > 0) {
      const thumb = makeThumbnail(strokes, logSize.w, logSize.h);
      if (thumb) setList(prev => prev.map(d =>
        d.id === activeId ? { ...d, thumbnail: thumb } : d));
    }

    const thumbnail = canvasEl && strokes.length > 0
      ? makeThumbnail(strokes, logSize.w, logSize.h) : null;

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    pendingSaveRef.current = { id: activeId, strokes, thumbnail };
    saveTimerRef.current = setTimeout(async () => {
      const { id, strokes: s, thumbnail: t } = pendingSaveRef.current;
      try {
        await api.patch('/api/drawings', { id, strokes: s, thumbnail: t }, token);
      } catch { showToast('Failed to save drawing', 'error'); }
    }, 1200);
  }, [activeId, token]);

  // Keep ref current so we can pass stable callback to canvas
  onCommitRef.current = handleCommit;
  const stableCommit = useCallback((...args) => onCommitRef.current(...args), []);

  return (
    <>
      <Card label="✏️ Drawings" color={CARD_COLOR} collapsed={false}>
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 440 }}>

          {/* ── Selector strip ─────────────────────────────────────────────── */}
          <div style={{ position: 'relative', marginBottom: 0 }}>
            <div style={{
              display: 'flex', gap: 6, overflowX: 'auto', overflowY: 'hidden',
              padding: '8px 44px 8px 8px', borderBottom: '1px solid var(--dl-border)',
              scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch',
              alignItems: 'center',
            }}>
              {list.length === 0 && (
                <span style={{
                  fontFamily: mono, fontSize: F.sm, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: 'var(--dl-middle)',
                  padding: '4px 4px',
                }}>No drawings yet</span>
              )}
              {list.map(d => (
                <button key={d.id} onClick={() => setActiveId(d.id)}
                  title={d.title}
                  style={{
                    flexShrink: 0, padding: 0, background: 'none', border: 'none',
                    cursor: 'pointer', borderRadius: 6, overflow: 'hidden',
                    outline: d.id === activeId
                      ? `2px solid ${CARD_COLOR}` : '2px solid transparent',
                    outlineOffset: 2, transition: 'outline-color 0.15s',
                    width: 56, height: 42,
                  }}>
                  {d.thumbnail
                    ? <img src={d.thumbnail} alt={d.title}
                        style={{ width: 56, height: 42, objectFit: 'cover',
                          display: 'block', borderRadius: 4 }} />
                    : <div style={{
                        width: 56, height: 42, background: '#f5f4f0',
                        borderRadius: 4, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        color: '#ccc',
                      }}>
                        <PenIcon />
                      </div>}
                </button>
              ))}
            </div>

            {/* Fade-out + pinned buttons */}
            <div style={{
              position: 'absolute', right: 0, top: 0, bottom: 0,
              display: 'flex', alignItems: 'center', gap: 2,
              paddingLeft: 20, paddingRight: 6,
              background: 'linear-gradient(to right, transparent, var(--dl-card) 40%)',
            }}>
              {/* Delete active drawing */}
              {activeId && (
                <button
                  onClick={() => {
                    const d = list.find(d => d.id === activeId);
                    setDeleteConfirm({ id: activeId, title: d?.title || 'this drawing' });
                  }}
                  title="Delete drawing"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--dl-middle)', display: 'flex', alignItems: 'center',
                    padding: '4px 5px', borderRadius: 100, transition: 'color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.color = '#c0392b'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}>
                  <TrashIcon />
                </button>
              )}
              {/* New drawing */}
              <button onClick={newDrawing} title="New drawing"
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--dl-middle)', display: 'flex', alignItems: 'center',
                  padding: '4px 6px', borderRadius: 100, transition: 'color 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5"  y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
          </div>

          {/* ── Canvas area ─────────────────────────────────────────────────── */}
          {!activeId ? (
            // Empty state
            <div style={{
              flex: 1, display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              minHeight: 340, color: 'var(--dl-middle)',
            }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
                style={{ opacity: 0.35 }}>
                <path d="M12 20h9"/>
                <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
              </svg>
              <button onClick={newDrawing}
                style={{
                  background: CARD_COLOR + '22', border: `1px solid ${CARD_COLOR}55`,
                  borderRadius: 8, padding: '8px 20px', cursor: 'pointer',
                  fontFamily: mono, fontSize: F.sm, letterSpacing: '0.06em',
                  textTransform: 'uppercase', color: CARD_COLOR, transition: 'background 0.15s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = CARD_COLOR + '44'}
                onMouseLeave={e => e.currentTarget.style.background = CARD_COLOR + '22'}>
                New Drawing
              </button>
            </div>
          ) : activeStrokes === null ? (
            // Loading
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              minHeight: 340, fontFamily: mono, fontSize: F.sm,
              color: 'var(--dl-border)', letterSpacing: '0.06em',
            }}>Loading…</div>
          ) : (
            <DrawingCanvas
              drawingId={activeId}
              initialStrokes={activeStrokes}
              onCommit={stableCommit}
            />
          )}
        </div>
      </Card>

      {/* ── Delete confirmation ─────────────────────────────────────────────── */}
      {deleteConfirm && (
        <>
          <div
            onClick={() => setDeleteConfirm(null)}
            style={{
              position: 'fixed', inset: 0, zIndex: 300,
              background: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
            }}
          />
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%,-50%)',
            zIndex: 301, width: 'min(320px, calc(100vw - 40px))',
            background: 'var(--dl-bg)', border: '1px solid var(--dl-border)',
            borderRadius: 14, padding: '24px 24px 20px',
            boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
            display: 'flex', flexDirection: 'column', gap: 8,
          }}>
            <div style={{
              fontFamily: mono, fontSize: 11, letterSpacing: '0.08em',
              textTransform: 'uppercase', color: CARD_COLOR, marginBottom: 4,
            }}>Delete drawing</div>
            <div style={{ fontFamily: mono, fontSize: 13, color: 'var(--dl-strong)', lineHeight: 1.5 }}>
              Delete <span style={{ color: CARD_COLOR }}>"{deleteConfirm.title}"</span>?<br />
              <span style={{ color: 'var(--dl-middle)', fontSize: 11 }}>This cannot be undone.</span>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setDeleteConfirm(null)}
                style={{
                  fontFamily: mono, fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', background: 'none',
                  border: '1px solid var(--dl-border)', borderRadius: 7,
                  padding: '8px 16px', cursor: 'pointer', color: 'var(--dl-highlight)',
                  transition: 'color 0.12s, border-color 0.12s',
                }}
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--dl-strong)'; e.currentTarget.style.borderColor = 'var(--dl-middle)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--dl-highlight)'; e.currentTarget.style.borderColor = 'var(--dl-border)'; }}>
                Cancel
              </button>
              <button
                onClick={() => { deleteDrawing(deleteConfirm.id); setDeleteConfirm(null); }}
                style={{
                  fontFamily: mono, fontSize: 11, letterSpacing: '0.06em',
                  textTransform: 'uppercase', background: '#c0392b22',
                  border: '1px solid #c0392b55', borderRadius: 7,
                  padding: '8px 16px', cursor: 'pointer', color: '#e05',
                  transition: 'background 0.12s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#c0392b44'}
                onMouseLeave={e => e.currentTarget.style.background = '#c0392b22'}>
                Delete
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
