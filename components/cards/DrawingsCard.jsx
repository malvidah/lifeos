"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { mono, F } from "@/lib/tokens";
import { useTheme } from "@/lib/theme";
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

const DEFAULT_COLOR = '#1c1b18';
const DEFAULT_SIZE = 8; // matches SIZE_PRESETS medium

const DPR = () =>
  typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 3) : 1;

// ── Shape recognition ──────────────────────────────────────────────────────────
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

function centroid(pts) {
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  return { cx, cy };
}

function isEllipse(pts) {
  if (pts.length < 10) return false;
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.hypot(last.x - first.x, last.y - first.y) > 40) return false;
  const { cx, cy } = centroid(pts);
  const rx = pts.reduce((m, p) => Math.max(m, Math.abs(p.x - cx)), 0);
  const ry = pts.reduce((m, p) => Math.max(m, Math.abs(p.y - cy)), 0);
  if (rx < 15 || ry < 15) return false;
  const inliers = pts.filter(p => {
    const nx = (p.x - cx) / rx, ny = (p.y - cy) / ry;
    return Math.abs(nx * nx + ny * ny - 1) < 0.35;
  });
  return inliers.length / pts.length > 0.65;
}

function fitEllipse(pts) {
  const { cx, cy } = centroid(pts);
  const rx = pts.reduce((m, p) => Math.max(m, Math.abs(p.x - cx)), 0);
  const ry = pts.reduce((m, p) => Math.max(m, Math.abs(p.y - cy)), 0);
  return { cx, cy, rx, ry };
}

// ── Canvas helpers ─────────────────────────────────────────────────────────────
function renderStroke(ctx, stroke, scale) {
  const pts = stroke.points;
  if (!pts || pts.length === 0) return;
  ctx.save();
  if (stroke.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color || '#1c1b18';
  }
  ctx.lineWidth = (stroke.size || 3) * scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (stroke.shape === 'line') {
    ctx.beginPath();
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
    ctx.lineTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale);
    ctx.stroke();
  } else if (stroke.shape === 'ellipse') {
    const { cx, cy, rx, ry } = stroke;
    ctx.beginPath();
    ctx.ellipse(cx * scale, cy * scale, rx * scale, ry * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Freehand: quadratic smoothing
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0].x * scale, pts[0].y * scale, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x * scale, pts[i].y * scale, mx * scale, my * scale);
      }
      const last = pts[pts.length - 1];
      ctx.lineTo(last.x * scale, last.y * scale);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function redrawCanvas(ctx, strokes, currentStroke, w, h, scale) {
  ctx.clearRect(0, 0, w * scale, h * scale);
  for (const s of strokes) renderStroke(ctx, s, scale);
  if (currentStroke && currentStroke.points.length > 0) renderStroke(ctx, currentStroke, scale);
}

function generateThumbnail(canvas, w, h) {
  const tw = 120, th = 90;
  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, tw, th);
  ctx.drawImage(canvas, 0, 0, tw, th);
  return tmp.toDataURL('image/png');
}

// ── SaveQueue ──────────────────────────────────────────────────────────────────
// Debounced save: waits 1.2 s of idle, then fires. Queues at most one pending call.
function useSaveQueue() {
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const savingRef = useRef(false);

  const flush = useCallback(async () => {
    if (savingRef.current || !pendingRef.current) return;
    savingRef.current = true;
    const { fn } = pendingRef.current;
    pendingRef.current = null;
    try { await fn(); } catch (e) { console.error('save error', e); }
    savingRef.current = false;
    if (pendingRef.current) flush();
  }, []);

  const enqueue = useCallback((fn) => {
    pendingRef.current = { fn };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, 1200);
  }, [flush]);

  return enqueue;
}

// ── DrawingCanvas ──────────────────────────────────────────────────────────────
function DrawingCanvas({ strokes, onStrokesChange, tool, color, size, paperBg, paperDots, dark, onDelete }) {
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const containerRef = useRef(null);
  const curStroke = useRef(null);
  const strokesRef = useRef(strokes);
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const logSizeRef = useRef({ w: 0, h: 0 });
  const activePen = useRef(false);
  const quickShapeTimer = useRef(null);
  const isDrawing = useRef(false);
  const historyRef = useRef([]); // past stroke arrays for undo
  const futureRef = useRef([]);  // undone stroke arrays for redo

  // Keep refs in sync with props
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => {
    strokesRef.current = strokes;
    // Redraw whenever strokes prop changes (e.g. loading a saved drawing)
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    redrawCanvas(ctx, strokes, null, w, h, DPR());
  }, [strokes]);

  // Expose canvas + logSize for thumbnail generation
  const onStrokesChangeRef = useRef(onStrokesChange);
  useEffect(() => { onStrokesChangeRef.current = onStrokesChange; }, [onStrokesChange]);

  // Resize canvas when container size changes
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (w === 0 || h === 0) return;
      const dpr = DPR();
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      logSizeRef.current = { w, h };
      const ctx = canvas.getContext('2d');
      redrawCanvas(ctx, strokesRef.current, curStroke.current, w, h, dpr);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // Global pointermove — tracks pointer across whole page so drawing never drops
  useEffect(() => {
    const onMove = (e) => {
      if (e.pointerType === 'touch' && activePen.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const insideCanvas = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;

      // Always update cursor when inside canvas
      const el = cursorRef.current;
      if (el) {
        if (insideCanvas || isDrawing.current) {
          const sz = sizeRef.current;
          el.style.display = 'block';
          el.style.width = sz + 'px';
          el.style.height = sz + 'px';
          el.style.transform = `translate(${x - sz / 2}px, ${y - sz / 2}px)`;
        } else {
          el.style.display = 'none';
        }
      }

      // Only add points when actively drawing
      if (!isDrawing.current || !curStroke.current) return;
      curStroke.current.points.push({ x, y, p: e.pressure ?? 0.5 });
      const { w, h } = logSizeRef.current;
      const ctx = canvas.getContext('2d');
      redrawCanvas(ctx, strokesRef.current, curStroke.current, w, h, DPR());
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Global pointerup/cancel fallback — ensures stroke always commits even if
  // the pointer leaves the canvas or the browser doesn't fire onPointerUp
  useEffect(() => {
    const finishStroke = (e) => {
      if (!isDrawing.current) return;
      isDrawing.current = false;
      activePen.current = false;
      const cur = curStroke.current;
      if (!cur) return;
      curStroke.current = null;

      // QuickShape detection
      if (quickShapeTimer.current) clearTimeout(quickShapeTimer.current);
      const shape = detectShape(cur.points);
      let finalStroke = cur;
      if (shape) {
        if (shape.type === 'line') {
          finalStroke = { ...cur, shape: 'line' };
        } else if (shape.type === 'ellipse') {
          finalStroke = { ...cur, shape: 'ellipse', cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
        }
      }

      if (finalStroke.points.length > 0) {
        historyRef.current.push(strokesRef.current); // save for undo
        futureRef.current = [];                       // clear redo stack
        const next = [...strokesRef.current, finalStroke];
        strokesRef.current = next;
        const canvas = canvasRef.current;
        const { w, h } = logSizeRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) redrawCanvas(ctx, next, null, w, h, DPR());
        onStrokesChangeRef.current?.(next, canvas, logSizeRef.current);
      }

      // Hide cursor circle
      if (cursorRef.current) cursorRef.current.style.display = 'none';
    };

    window.addEventListener('pointerup', finishStroke);
    window.addEventListener('pointercancel', finishStroke);
    return () => {
      window.removeEventListener('pointerup', finishStroke);
      window.removeEventListener('pointercancel', finishStroke);
    };
  }, []); // stable refs only — no deps needed

  const getLogicalPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top),
    };
  };

  const moveCursor = (x, y) => {
    const el = cursorRef.current;
    if (!el) return;
    const sz = sizeRef.current;
    el.style.display = 'block';
    el.style.width = sz + 'px';
    el.style.height = sz + 'px';
    el.style.transform = `translate(${x - sz / 2}px, ${y - sz / 2}px)`;
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.pointerType === 'touch' && activePen.current) return;
    if (e.pointerType === 'pen') activePen.current = true;

    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    const canvas = canvasRef.current;
    const pos = getLogicalPos(e, canvas);
    isDrawing.current = true;

    curStroke.current = {
      tool: toolRef.current,
      color: colorRef.current,
      size: sizeRef.current,
      points: [{ x: pos.x, y: pos.y, p: e.pressure ?? 0.5 }],
    };

    moveCursor(pos.x, pos.y);
  };

  const onPointerMove = (e) => {
    const canvas = canvasRef.current;
    const pos = getLogicalPos(e, canvas);
    moveCursor(pos.x, pos.y);

    if (!isDrawing.current || !curStroke.current) return;
    if (e.pointerType === 'touch' && activePen.current) return;

    curStroke.current.points.push({ x: pos.x, y: pos.y, p: e.pressure ?? 0.5 });

    const { w, h } = logSizeRef.current;
    const ctx = canvas.getContext('2d');
    const dpr = DPR();
    redrawCanvas(ctx, strokesRef.current, curStroke.current, w, h, dpr);
  };

  const onPointerLeave = () => {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  };

  const applyStrokes = (next) => {
    strokesRef.current = next;
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) redrawCanvas(ctx, next, null, w, h, DPR());
    onStrokesChangeRef.current?.(next, canvas, logSizeRef.current);
  };

  const handleUndo = () => {
    if (historyRef.current.length === 0) return;
    futureRef.current.push(strokesRef.current);
    applyStrokes(historyRef.current.pop());
  };

  const handleRedo = () => {
    if (futureRef.current.length === 0) return;
    historyRef.current.push(strokesRef.current);
    applyStrokes(futureRef.current.pop());
  };

  const handleClear = () => {
    if (strokesRef.current.length === 0) return;
    historyRef.current.push(strokesRef.current);
    futureRef.current = [];
    applyStrokes([]);
  };

  // Keyboard shortcuts: Cmd+Z = undo, Cmd+Shift+Z = redo
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} style={{
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 6,
      touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
      // Dot grid — purely decorative CSS, never touches the canvas or exports
      background: paperBg,
      backgroundImage: `radial-gradient(circle, ${paperDots} 1px, transparent 1px)`,
      backgroundSize: '20px 20px',
    }}>
      <canvas
        ref={canvasRef}
        style={{ display: 'block', cursor: 'none', touchAction: 'none', userSelect: 'none' }}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
      />
      {/* Custom cursor circle */}
      <div
        ref={cursorRef}
        style={{
          display: 'none',
          position: 'absolute',
          top: 0,
          left: 0,
          borderRadius: '50%',
          border: '1.5px solid rgba(0,0,0,0.5)',
          background: 'rgba(0,0,0,0.08)',
          pointerEvents: 'none',
          zIndex: 10,
          boxSizing: 'border-box',
        }}
      />

      {/* ── Left: Undo + Redo + Size + Delete ───────────────────────────────── */}
      <LeftControls
        onUndo={handleUndo}
        onRedo={handleRedo}
        onDelete={onDelete}
        sizeRef={sizeRef}
        dark={dark}
      />
    </div>
  );
}

// ── Size presets ───────────────────────────────────────────────────────────────
const SIZE_PRESETS = [
  { label: 'S', value: 3,  dot: 4  },
  { label: 'M', value: 8,  dot: 9  },
  { label: 'L', value: 20, dot: 16 },
];

// ── Left controls: undo/redo, size toggles, delete ────────────────────────────
function LeftControls({ onUndo, onRedo, onDelete, sizeRef, dark }) {
  const [sizeIdx, setSizeIdx] = useState(1); // default: Medium
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Keep sizeRef in sync with selected preset
  useEffect(() => {
    sizeRef.current = SIZE_PRESETS[sizeIdx].value;
  }, [sizeIdx, sizeRef]);

  return (
    <div style={{
      position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, zIndex: 20,
    }}>
      {/* Undo */}
      <button onPointerDown={e => { e.stopPropagation(); onUndo(); }} style={pillBtnStyle(dark)} title="Undo (⌘Z)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6"/><path d="M3 13C4.7 8.7 8.9 6 14 6a9 9 0 0 1 0 18 9 9 0 0 1-8.46-5.9"/>
        </svg>
      </button>

      {/* Redo */}
      <button onPointerDown={e => { e.stopPropagation(); onRedo(); }} style={pillBtnStyle(dark)} title="Redo (⌘⇧Z)">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6"/><path d="M21 13C19.3 8.7 15.1 6 10 6a9 9 0 0 0 0 18 9 9 0 0 0 8.46-5.9"/>
        </svg>
      </button>

      {/* Size toggles: S / M / L */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        background: dark ? 'rgba(62,54,44,0.95)' : 'rgba(240,238,234,0.92)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        border: dark ? '1px solid rgba(255,255,255,0.10)' : '1px solid rgba(0,0,0,0.10)',
        borderRadius: 14,
        boxShadow: dark ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
        overflow: 'hidden', width: 28,
      }}>
        {SIZE_PRESETS.map((preset, i) => (
          <button
            key={preset.label}
            onPointerDown={e => { e.stopPropagation(); setSizeIdx(i); }}
            title={`${preset.label} (${preset.value}px)`}
            style={{
              width: 28, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: sizeIdx === i ? dark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.12)' : 'transparent',
              border: 'none',
              borderBottom: i < SIZE_PRESETS.length - 1
                ? dark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)'
                : 'none',
              cursor: 'pointer', padding: 0, outline: 'none',
            }}
          >
            <div style={{
              width: preset.dot, height: preset.dot, borderRadius: '50%',
              background: sizeIdx === i
                ? dark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.55)'
                : dark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.25)',
            }} />
          </button>
        ))}
      </div>

      {/* Delete drawing — with confirm */}
      {confirmDelete ? (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
          background: dark ? 'rgba(62,54,44,0.97)' : 'rgba(240,238,234,0.97)',
          backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
          border: dark ? '1px solid rgba(255,100,100,0.4)' : '1px solid rgba(180,0,0,0.25)',
          borderRadius: 10, padding: '8px 6px',
          boxShadow: dark ? '0 2px 12px rgba(0,0,0,0.6)' : '0 2px 12px rgba(0,0,0,0.18)',
        }}>
          <span style={{
            fontFamily: mono, fontSize: 9, fontWeight: 400, letterSpacing: '0.06em',
            textTransform: 'uppercase', color: dark ? 'rgba(255,120,120,0.9)' : 'rgba(180,0,0,0.8)',
            whiteSpace: 'nowrap',
          }}>Delete?</span>
          <button
            onPointerDown={e => { e.stopPropagation(); setConfirmDelete(false); onDelete(); }}
            style={{ ...pillBtnStyle(dark), background: 'rgba(200,50,50,0.85)', color: '#fff', border: '1px solid rgba(255,100,100,0.4)' }}
            title="Yes, delete"
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="2" y1="2" x2="12" y2="12"/><line x1="12" y1="2" x2="2" y2="12"/>
            </svg>
          </button>
          <button
            onPointerDown={e => { e.stopPropagation(); setConfirmDelete(false); }}
            style={pillBtnStyle(dark)}
            title="Cancel"
          >
            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <polyline points="2,7 5.5,11 12,3"/>
            </svg>
          </button>
        </div>
      ) : (
        <button onPointerDown={e => { e.stopPropagation(); setConfirmDelete(true); }} style={pillBtnStyle(dark)} title="Delete drawing">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
          </svg>
        </button>
      )}
    </div>
  );
}

const pillBtnStyle = (dark = false) => ({
  width: 28, height: 28, borderRadius: '50%',
  border: dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.12)',
  background: dark ? 'rgba(62,54,44,0.95)' : 'rgba(240,238,234,0.92)',
  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
  boxShadow: dark ? '0 2px 8px rgba(0,0,0,0.5)' : '0 2px 8px rgba(0,0,0,0.15)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer',
  color: dark ? 'rgba(255,255,255,0.78)' : 'rgba(0,0,0,0.6)',
  padding: 0, outline: 'none', touchAction: 'none',
});

const saveMenuItemStyle = {
  display: 'block', width: '100%', textAlign: 'left', border: 'none', borderRadius: 6,
  background: 'transparent', color: 'rgba(255,255,255,0.88)', cursor: 'pointer',
  fontFamily: mono, fontSize: 12, padding: '7px 12px',
  letterSpacing: '0.04em', outline: 'none',
};

// ── Right toolbar: Brush, Eraser, Color ───────────────────────────────────────
const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent || '');

function RightToolbar({ tool, setTool, color, setColor, onSave, dark }) {
  const [showPalette, setShowPalette] = useState(false);
  const [showSaveMenu, setShowSaveMenu] = useState(false);

  return (
    <div style={{
      position: 'absolute',
      top: 10,
      right: 10,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      zIndex: 20,
    }}>
      {/* Brush */}
      <button
        onPointerDown={e => { e.stopPropagation(); setTool('pen'); }}
        style={{
          ...pillBtnStyle(dark),
          border: tool === 'pen'
            ? dark ? '2px solid rgba(255,255,255,0.6)' : '2px solid rgba(0,0,0,0.5)'
            : dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.12)',
          background: tool === 'pen'
            ? dark ? 'rgba(90,80,68,0.98)' : 'rgba(255,255,255,0.95)'
            : undefined,
        }}
        title="Brush"
      >
        {/* simple pen: diagonal line + nib dot */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <line x1="11" y1="2" x2="3" y2="10"/>
          <circle cx="2.5" cy="11" r="1.5" fill="currentColor" stroke="none"/>
        </svg>
      </button>

      {/* Eraser */}
      <button
        onPointerDown={e => { e.stopPropagation(); setTool('eraser'); }}
        style={{
          ...pillBtnStyle(dark),
          border: tool === 'eraser'
            ? dark ? '2px solid rgba(255,255,255,0.6)' : '2px solid rgba(0,0,0,0.5)'
            : dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.12)',
          background: tool === 'eraser'
            ? dark ? 'rgba(90,80,68,0.98)' : 'rgba(255,255,255,0.95)'
            : undefined,
        }}
        title="Eraser"
      >
        {/* simple eraser: small filled rectangle */}
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="5" width="10" height="6" rx="1.5"/>
        </svg>
      </button>

      {/* Save / share */}
      <div style={{ position: 'relative' }}>
        <button
          onPointerDown={e => {
            e.stopPropagation();
            if (isIOS) { onSave('native'); }
            else { setShowSaveMenu(p => !p); }
          }}
          style={pillBtnStyle(dark)}
          title={isIOS ? 'Share drawing' : 'Save drawing'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
        {showSaveMenu && (
          <div style={{
            position: 'absolute', top: 36, right: 0,
            background: 'rgba(22,20,18,0.94)',
            backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
            borderRadius: 10, padding: 6,
            display: 'flex', flexDirection: 'column', gap: 3,
            boxShadow: '0 4px 24px rgba(0,0,0,0.45)', zIndex: 30,
            minWidth: 210,
          }}>
            <button
              onPointerDown={e => { e.stopPropagation(); setShowSaveMenu(false); onSave('paper'); }}
              style={saveMenuItemStyle}
            >↓ Save JPEG (with background)</button>
            <button
              onPointerDown={e => { e.stopPropagation(); setShowSaveMenu(false); onSave('transparent'); }}
              style={saveMenuItemStyle}
            >↓ Save PNG (transparent)</button>
          </div>
        )}
      </div>

      {/* Color circle + palette */}
      <div style={{ position: 'relative' }}>
        <button
          onPointerDown={e => { e.stopPropagation(); setShowPalette(p => !p); }}
          style={{
            ...pillBtnStyle(dark),
            background: color,
            border: '2px solid rgba(255,255,255,0.7)',
            boxShadow: '0 0 0 1px rgba(0,0,0,0.2), 0 2px 8px rgba(0,0,0,0.2)',
          }}
          title="Color"
        />
        {showPalette && (
          <div
            style={{
              position: 'absolute',
              top: 36,
              right: 0,
              background: 'rgba(28,27,24,0.88)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              borderRadius: 10,
              padding: 8,
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 24px)',
              gap: 5,
              boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
              zIndex: 30,
            }}
          >
            {PALETTE.map(c => (
              <button
                key={c}
                onPointerDown={e => { e.stopPropagation(); setColor(c); setShowPalette(false); }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: '50%',
                  background: c,
                  border: c === color
                    ? '2px solid rgba(255,255,255,0.9)'
                    : c === '#ffffff'
                      ? '1.5px solid rgba(255,255,255,0.3)'
                      : '1.5px solid transparent',
                  cursor: 'pointer',
                  padding: 0,
                  outline: 'none',
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Drawing tab strip ─────────────────────────────────────────────────────────
function DrawingStrip({ drawings, selectedId, onSelect, onCreate, isLoading, dark }) {
  return (
    <div style={{
      display: 'flex', gap: 4, padding: '6px 0 4px 0', overflowX: 'auto',
      alignItems: 'center', minHeight: 40, flexShrink: 0,
      scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      {/* New drawing button */}
      <button
        onClick={onCreate}
        style={{
          flexShrink: 0, height: 28, width: 28, borderRadius: 6,
          border: dark ? '1.5px dashed rgba(255,255,255,0.2)' : '1.5px dashed rgba(0,0,0,0.22)',
          background: 'transparent', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 18, color: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)',
        }}
        title="New drawing"
      >+</button>

      {isLoading && (
        <span style={{ fontSize: F.xs, color: 'var(--dl-middle)', fontFamily: mono, padding: '0 4px' }}>loading…</span>
      )}

      {drawings.map(d => {
        const selected = selectedId === d.id;
        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            title={d.title}
            style={{
              flexShrink: 0, height: 28, maxWidth: 140, padding: '0 10px', borderRadius: 6,
              border: selected
                ? '2px solid var(--dl-accent)'
                : dark ? '1.5px solid rgba(255,255,255,0.13)' : '1.5px solid rgba(0,0,0,0.13)',
              background: selected
                ? dark ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.9)'
                : 'transparent',
              cursor: 'pointer',
              fontFamily: mono, fontSize: F.xs, fontWeight: 400,
              letterSpacing: '0.06em', textTransform: 'uppercase',
              color: selected ? 'var(--dl-strong)' : 'var(--dl-middle)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            {d.title || 'Untitled'}
          </button>
        );
      })}
    </div>
  );
}

// ── Inline title editor ────────────────────────────────────────────────────────
const titleStyle = {
  fontFamily: mono, fontSize: 13, fontWeight: 400,
  letterSpacing: '0.1em', textTransform: 'uppercase',
  color: 'var(--dl-strong)', padding: '2px 0', marginBottom: 4,
};

function DrawingTitleEditor({ title, onRename }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef(null);

  useEffect(() => { setDraft(title); setEditing(false); }, [title]);

  // Explicitly focus + select after React commits the input to the DOM
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    const trimmed = draft.trim() || 'Untitled';
    setDraft(trimmed);
    setEditing(false);
    if (trimmed !== title) onRename(trimmed);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(title); setEditing(false); }
        }}
        style={{
          ...titleStyle,
          width: '100%', background: 'transparent', border: 'none',
          borderBottom: '1.5px solid var(--dl-accent)', outline: 'none',
          display: 'block',
        }}
      />
    );
  }

  return (
    <div
      onPointerDown={e => { e.stopPropagation(); setEditing(true); }}
      style={{
        ...titleStyle,
        cursor: 'text',
        userSelect: 'none',
        borderBottom: '1px solid transparent',
        transition: 'border-color 0.15s',
        minHeight: 22,
      }}
      onMouseEnter={e => { e.currentTarget.style.borderBottomColor = 'var(--dl-accent)'; }}
      onMouseLeave={e => { e.currentTarget.style.borderBottomColor = 'transparent'; }}
      title="Click to rename"
    >
      {title || 'Untitled'}
    </div>
  );
}

// ── Main DrawingsCard ──────────────────────────────────────────────────────────
export default function DrawingsCard({ token, userId, onDrawingNamesChange }) {
  const { theme } = useTheme();
  const dark      = theme === 'dark';
  const paperBg   = dark ? '#433c34' : '#f5f0e8';
  const paperDots = dark ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.15)';
  const paperBgRef = useRef(paperBg);
  useEffect(() => { paperBgRef.current = paperBg; }, [paperBg]);

  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [title, setTitle] = useState('Untitled');
  const [strokes, setStrokes] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(() => theme === 'dark' ? '#ffffff' : DEFAULT_COLOR);
  const [isLoading, setIsLoading] = useState(false);
  const enqueue = useSaveQueue();
  const selectedIdRef = useRef(selectedId);
  const lastCanvasRef = useRef(null); // for save/export
  const titleRef = useRef(title);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);
  useEffect(() => { titleRef.current = title; }, [title]);

  // Propagate drawing titles up so NoteContext can provide them for /d suggestions
  const onDrawingNamesChangeRef = useRef(onDrawingNamesChange);
  useEffect(() => { onDrawingNamesChangeRef.current = onDrawingNamesChange; }, [onDrawingNamesChange]);
  useEffect(() => {
    onDrawingNamesChangeRef.current?.(drawings.map(d => ({
      title: d.title || 'Untitled',
      thumbnail: d.thumbnail || null,
    })));
  }, [drawings]);

  const handleSave = useCallback(async (option) => {
    const canvas = lastCanvasRef.current;
    if (!canvas) return;
    const fname = (titleRef.current || 'drawing').replace(/[^a-z0-9 _-]/gi, '').trim() || 'drawing';

    if (option === 'native') {
      // iOS: native share sheet
      const out = document.createElement('canvas');
      out.width = canvas.width; out.height = canvas.height;
      const ctx = out.getContext('2d');
      ctx.fillStyle = paperBgRef.current;
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(canvas, 0, 0);
      if (navigator.share && navigator.canShare) {
        const blob = await new Promise(res => out.toBlob(res, 'image/jpeg', 0.92));
        const file = new File([blob], `${fname}.jpg`, { type: 'image/jpeg' });
        if (navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: titleRef.current || 'Drawing' }); return; } catch (_) {}
        }
      }
      // iOS fallback
      const a = document.createElement('a');
      a.href = out.toDataURL('image/jpeg', 0.92);
      a.download = `${fname}.jpg`; a.click();
      return;
    }

    if (option === 'transparent') {
      // Save PNG with transparent background
      const a = document.createElement('a');
      a.href = canvas.toDataURL('image/png');
      a.download = `${fname}.png`; a.click();
      return;
    }

    // 'paper' — Save JPEG with the paper background
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d');
    ctx.fillStyle = paperBgRef.current;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/jpeg', 0.92);
    a.download = `${fname}.jpg`; a.click();
  }, []);

  // Load drawing list on mount
  useEffect(() => {
    if (!token) return;
    setIsLoading(true);
    api.get('/api/drawings', token)
      .then(d => {
        const list = d.drawings ?? [];
        setDrawings(list);
        if (list.length > 0) {
          loadDrawing(list[0].id);
        } else {
          createDrawing();
        }
      })
      .catch(e => console.error('drawings list error', e))
      .finally(() => setIsLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadDrawing = async (id) => {
    if (!token) return;
    try {
      const d = await api.get(`/api/drawings?id=${id}`, token);
      const drawing = d.drawing;
      if (!drawing) return;
      setSelectedId(drawing.id);
      setTitle(drawing.title ?? 'Untitled');
      setStrokes(drawing.strokes ?? []);
    } catch (e) {
      console.error('load drawing error', e);
      showToast('Failed to load drawing');
    }
  };

  const createDrawing = async () => {
    if (!token) return;
    try {
      const d = await api.post('/api/drawings', { title: 'Untitled', strokes: [], thumbnail: null }, token);
      const drawing = d.drawing;
      if (!drawing) return;
      setDrawings(prev => [drawing, ...prev]);
      setSelectedId(drawing.id);
      setTitle(drawing.title ?? 'Untitled');
      setStrokes([]);
    } catch (e) {
      console.error('create drawing error', e);
      showToast('Failed to create drawing');
    }
  };

  const handleRenameDrawing = useCallback(async (newTitle) => {
    const id = selectedIdRef.current;
    if (!id || !token) return;
    setTitle(newTitle);
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, title: newTitle } : d));
    try {
      await api.patch('/api/drawings', { id, title: newTitle }, token);
    } catch (e) {
      console.error('rename drawing error', e);
    }
  }, [token]);

  const handleDeleteDrawing = useCallback(async () => {
    const id = selectedIdRef.current;
    if (!id || !token) return;
    // Optimistically remove from list
    const remaining = drawings.filter(d => d.id !== id);
    setDrawings(remaining);
    try {
      await api.delete(`/api/drawings?id=${id}`, token);
    } catch (e) {
      console.error('delete drawing error', e);
      showToast('Failed to delete drawing');
    }
    // Load next drawing or create fresh one
    if (remaining.length > 0) {
      loadDrawing(remaining[0].id);
    } else {
      createDrawing();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, drawings]);

  const handleStrokesChange = useCallback((nextStrokes, canvas, logSize) => {
    setStrokes(nextStrokes);
    if (canvas) lastCanvasRef.current = canvas;
    const id = selectedIdRef.current;
    if (!id || !token) return;

    enqueue(async () => {
      let thumbnail = null;
      if (canvas && logSize.w > 0) {
        thumbnail = generateThumbnail(canvas, logSize.w, logSize.h);
      }
      try {
        const d = await api.patch('/api/drawings', { id, strokes: nextStrokes, thumbnail }, token);
        if (d.drawing) {
          setDrawings(prev => prev.map(dr => dr.id === id ? { ...dr, thumbnail: d.drawing.thumbnail, updated_at: d.drawing.updated_at } : dr));
        }
      } catch (e) {
        console.error('save drawing error', e);
      }
    });
  }, [token, enqueue]);

  return (
    <Card label="🖼️ Drawings" color={CARD_COLOR} collapsed={false} autoHeight expandHref="/drawings">
      <DrawingStrip
        drawings={drawings}
        selectedId={selectedId}
        onSelect={loadDrawing}
        onCreate={createDrawing}
        isLoading={isLoading}
        dark={dark}
      />
      <DrawingTitleEditor title={title} onRename={handleRenameDrawing} />
      <div style={{ position: 'relative', width: '100%', height: 400, flexShrink: 0 }}>
        {/* Right floating toolbar — sits over canvas */}
        <RightToolbar tool={tool} setTool={setTool} color={color} setColor={setColor} onSave={handleSave} dark={dark} />
        {/* Canvas */}
        <DrawingCanvas
          strokes={strokes}
          onStrokesChange={handleStrokesChange}
          tool={tool}
          color={color}
          size={DEFAULT_SIZE}
          paperBg={paperBg}
          paperDots={paperDots}
          dark={dark}
          onDelete={handleDeleteDrawing}
        />
      </div>
    </Card>
  );
}
