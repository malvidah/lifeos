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

const DEFAULT_COLOR = '#1c1b18';
const MIN_SIZE = 1;
const MAX_SIZE = 28;
const DEFAULT_SIZE = 5;

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
function DrawingCanvas({ strokes, onStrokesChange, tool, color, size }) {
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
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%', background: '#fff', overflow: 'hidden', borderRadius: 6, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}>
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

      {/* ── Left: Size slider + Undo + Redo + Clear ──────────────────────────── */}
      <LeftControls
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClear={handleClear}
        sizeRef={sizeRef}
      />
    </div>
  );
}

// ── Vertical size slider (Procreate-style, drag up = bigger) ──────────────────
function LeftControls({ onUndo, onRedo, onClear, sizeRef }) {
  const [size, setSize] = useState(DEFAULT_SIZE);
  const sliderTrackRef = useRef(null);
  const dragRef = useRef(null);

  // Keep sizeRef in sync
  useEffect(() => { sizeRef.current = size; }, [size, sizeRef]);

  const TRACK_H = 160;

  const sizeToFraction = (s) => (s - MIN_SIZE) / (MAX_SIZE - MIN_SIZE);
  const fractionToSize = (f) => Math.round(MIN_SIZE + f * (MAX_SIZE - MIN_SIZE));

  const onSliderPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    const rect = sliderTrackRef.current.getBoundingClientRect();
    dragRef.current = { startY: e.clientY, startFrac: sizeToFraction(size), trackH: rect.height };
  };

  const onSliderPointerMove = (e) => {
    if (!dragRef.current) return;
    const { startY, startFrac, trackH } = dragRef.current;
    const dy = startY - e.clientY; // drag up = bigger
    const delta = dy / trackH;
    const newFrac = Math.max(0, Math.min(1, startFrac + delta));
    const newSize = fractionToSize(newFrac);
    setSize(newSize);
  };

  const onSliderPointerUp = () => { dragRef.current = null; };

  const frac = sizeToFraction(size);
  const fillH = Math.round(frac * TRACK_H);

  return (
    <div style={{
      position: 'absolute',
      left: 10,
      top: '50%',
      transform: 'translateY(-50%)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 8,
      zIndex: 20,
    }}>
      {/* Undo */}
      <button
        onPointerDown={e => { e.stopPropagation(); onUndo(); }}
        style={pillBtnStyle}
        title="Undo (⌘Z)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6"/><path d="M3 13C4.7 8.7 8.9 6 14 6a9 9 0 0 1 0 18 9 9 0 0 1-8.46-5.9"/>
        </svg>
      </button>

      {/* Redo */}
      <button
        onPointerDown={e => { e.stopPropagation(); onRedo(); }}
        style={pillBtnStyle}
        title="Redo (⌘⇧Z)"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6"/><path d="M21 13C19.3 8.7 15.1 6 10 6a9 9 0 0 0 0 18 9 9 0 0 0 8.46-5.9"/>
        </svg>
      </button>

      {/* Vertical size slider pill */}
      <div
        ref={sliderTrackRef}
        onPointerDown={onSliderPointerDown}
        onPointerMove={onSliderPointerMove}
        onPointerUp={onSliderPointerUp}
        onPointerCancel={onSliderPointerUp}
        style={{
          width: 28,
          height: TRACK_H,
          borderRadius: 14,
          background: 'rgba(240,238,234,0.92)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: '1px solid rgba(0,0,0,0.10)',
          cursor: 'ns-resize',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          touchAction: 'none',
        }}
        title={`Size: ${size}px`}
      >
        {/* Fill from bottom */}
        <div style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: fillH,
          background: 'rgba(0,0,0,0.18)',
          transition: 'height 0.05s',
        }} />
        {/* Grip dot */}
        <div style={{
          position: 'absolute',
          bottom: fillH - 5,
          left: '50%',
          transform: 'translateX(-50%)',
          width: Math.max(4, Math.min(20, size * 0.9)),
          height: Math.max(4, Math.min(20, size * 0.9)),
          borderRadius: '50%',
          background: 'rgba(0,0,0,0.35)',
          transition: 'bottom 0.05s, width 0.05s, height 0.05s',
        }} />
      </div>

      {/* Clear */}
      <button
        onPointerDown={e => { e.stopPropagation(); onClear(); }}
        style={pillBtnStyle}
        title="Clear canvas"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  );
}

const pillBtnStyle = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  border: '1px solid rgba(0,0,0,0.12)',
  background: 'rgba(240,238,234,0.92)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  color: 'rgba(0,0,0,0.6)',
  padding: 0,
  outline: 'none',
  touchAction: 'none',
};

// ── Right toolbar: Brush, Eraser, Color ───────────────────────────────────────
function RightToolbar({ tool, setTool, color, setColor }) {
  const [showPalette, setShowPalette] = useState(false);

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
          ...pillBtnStyle,
          border: tool === 'pen' ? '2px solid rgba(0,0,0,0.5)' : '1px solid rgba(0,0,0,0.12)',
          background: tool === 'pen' ? 'rgba(255,255,255,0.95)' : 'rgba(240,238,234,0.92)',
        }}
        title="Brush"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 19c-1.5 0-3-1-3-3 0-1.7 1.3-3 3-3s3 1.3 3 3c0 2.5-3 5-6 6"/>
          <path d="M9.5 9.5l8-8a2.1 2.1 0 0 1 3 3l-8 8"/>
        </svg>
      </button>

      {/* Eraser */}
      <button
        onPointerDown={e => { e.stopPropagation(); setTool('eraser'); }}
        style={{
          ...pillBtnStyle,
          border: tool === 'eraser' ? '2px solid rgba(0,0,0,0.5)' : '1px solid rgba(0,0,0,0.12)',
          background: tool === 'eraser' ? 'rgba(255,255,255,0.95)' : 'rgba(240,238,234,0.92)',
        }}
        title="Eraser"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 20H7L3 16l12-12 5 5-5 5"/>
          <path d="M6.7 10.3L3 14"/>
        </svg>
      </button>

      {/* Color circle + palette */}
      <div style={{ position: 'relative' }}>
        <button
          onPointerDown={e => { e.stopPropagation(); setShowPalette(p => !p); }}
          style={{
            ...pillBtnStyle,
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

// ── Drawing selector strip ─────────────────────────────────────────────────────
function DrawingStrip({ drawings, selectedId, onSelect, onCreate, isLoading }) {
  return (
    <div style={{
      display: 'flex',
      gap: 6,
      padding: '6px 0 4px 0',
      overflowX: 'auto',
      alignItems: 'center',
      minHeight: 52,
      flexShrink: 0,
    }}>
      <button
        onClick={onCreate}
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: 6,
          border: '1.5px dashed rgba(0,0,0,0.25)',
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 20,
          color: 'rgba(0,0,0,0.4)',
          transition: 'background 0.15s',
        }}
        title="New drawing"
      >+</button>

      {isLoading && (
        <span style={{ fontSize: F.xs, color: 'var(--dl-middle)', fontFamily: mono }}>loading…</span>
      )}

      {drawings.map(d => (
        <button
          key={d.id}
          onClick={() => onSelect(d.id)}
          style={{
            flexShrink: 0,
            width: 60,
            height: 40,
            borderRadius: 6,
            border: selectedId === d.id ? '2px solid var(--dl-accent)' : '1.5px solid rgba(0,0,0,0.15)',
            background: '#fff',
            cursor: 'pointer',
            overflow: 'hidden',
            padding: 0,
            position: 'relative',
          }}
          title={d.title}
        >
          {d.thumbnail
            ? <img src={d.thumbnail} alt={d.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', background: '#f5f4f0' }} />
          }
        </button>
      ))}
    </div>
  );
}

// ── Main DrawingsCard ──────────────────────────────────────────────────────────
export default function DrawingsCard({ token, userId }) {
  const [drawings, setDrawings] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [strokes, setStrokes] = useState([]);
  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [isLoading, setIsLoading] = useState(false);
  const enqueue = useSaveQueue();
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

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
      setStrokes([]);
    } catch (e) {
      console.error('create drawing error', e);
      showToast('Failed to create drawing');
    }
  };

  const handleStrokesChange = useCallback((nextStrokes, canvas, logSize) => {
    setStrokes(nextStrokes);
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
    <Card label="✏️ Drawings" color={CARD_COLOR} collapsed={false} autoHeight expandHref="/drawings">
      <DrawingStrip
        drawings={drawings}
        selectedId={selectedId}
        onSelect={loadDrawing}
        onCreate={createDrawing}
        isLoading={isLoading}
      />
      <div style={{ position: 'relative', width: '100%', height: 400, flexShrink: 0 }}>
        {/* Right floating toolbar — sits over canvas */}
        <RightToolbar tool={tool} setTool={setTool} color={color} setColor={setColor} />
        {/* Canvas */}
        <DrawingCanvas
          strokes={strokes}
          onStrokesChange={handleStrokesChange}
          tool={tool}
          color={color}
          size={DEFAULT_SIZE} // sizeRef managed inside DrawingCanvas via LeftControls
        />
      </div>
    </Card>
  );
}
