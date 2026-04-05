"use client";
import { useState, useEffect, useRef, useCallback } from "react";
import { mono, F } from "@/lib/tokens";
import { useTheme } from "@/lib/theme";
import { api } from "@/lib/api";
import { Card } from "../ui/primitives.jsx";
import { showToast } from "../ui/Toast.jsx";
import { getStroke } from "perfect-freehand";
import { MiniDrawingCanvas } from "../widgets/JournalEditor.jsx";

// Convert perfect-freehand outline array → SVG path string (for Path2D)
function svgPathFromPFStroke(outline) {
  if (!outline.length) return '';
  const d = outline.reduce((acc, [x0, y0], i, arr) => {
    const [x1, y1] = arr[(i + 1) % arr.length];
    acc.push(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    return acc;
  }, ['M', ...outline[0], 'Q']);
  d.push('Z');
  return d.join(' ');
}

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

  const isEraser = stroke.tool === 'eraser';
  const color = stroke.color || '#1c1b18';
  const strokePx = (stroke.size || 3) * scale; // logical-unit size → canvas pixels

  if (isEraser) {
    ctx.globalCompositeOperation = 'destination-out';
  } else {
    ctx.globalCompositeOperation = 'source-over';
  }

  if (stroke.shape === 'line') {
    // Geometric line: keep simple stroked path
    ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color;
    ctx.lineWidth = strokePx;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x * scale, pts[0].y * scale);
    ctx.lineTo(pts[pts.length - 1].x * scale, pts[pts.length - 1].y * scale);
    ctx.stroke();
  } else if (stroke.shape === 'ellipse') {
    // Geometric ellipse: keep simple stroked path
    ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : color;
    ctx.lineWidth = strokePx;
    const { cx, cy, rx, ry } = stroke;
    ctx.beginPath();
    ctx.ellipse(cx * scale, cy * scale, rx * scale, ry * scale, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    // Freehand: use perfect-freehand for calligraphic tapered strokes
    const pfPts = pts.map(p => [p.x * scale, p.y * scale]);
    const outline = getStroke(pfPts, {
      size: strokePx * 1.5,     // diameter at full pressure
      thinning: 0.45,           // how much stroke tapers
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: true,   // velocity-based pressure simulation
      last: true,               // treat the last point as the final point
    });
    if (outline.length) {
      const pathData = svgPathFromPFStroke(outline);
      ctx.fillStyle = isEraser ? 'rgba(0,0,0,1)' : color;
      ctx.fill(new Path2D(pathData));
    }
  }

  ctx.restore();
}

// shiftHeld: if true, renders the current stroke as a ghost + overlays the
// detected snapped shape as a preview of what will be committed on release.
// vp: { x, y, scale } viewport — when provided, applies it as a ctx transform
//   so strokes stored in world coords are correctly clipped to the canvas area.
//   Without vp, strokes are drawn at world_coord * dpr (backward-compat).
function redrawCanvas(ctx, strokes, currentStroke, w, h, dpr, shiftHeld = false, vp = null) {
  ctx.clearRect(0, 0, w * dpr, h * dpr);
  ctx.save();
  if (vp) {
    // Apply viewport: world coords → physical canvas pixels
    // canvas_px = world * vpScale * dpr + vpOffset * dpr
    ctx.setTransform(vp.scale * dpr, 0, 0, vp.scale * dpr, vp.x * dpr, vp.y * dpr);
    // renderStroke uses scale=1 → world coords, ctx transform handles dpr+vpScale
    const rs = (s) => renderStroke(ctx, s, 1);
    for (const s of strokes) rs(s);
    if (currentStroke && currentStroke.points.length > 0) {
      if (shiftHeld) {
        ctx.globalAlpha = 0.22;
        rs(currentStroke);
        ctx.globalAlpha = 1;
        const shape = detectShape(currentStroke.points);
        if (shape) {
          const snapped = shape.type === 'line'
            ? { ...currentStroke, shape: 'line' }
            : { ...currentStroke, shape: 'ellipse', cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
          rs(snapped);
        } else {
          rs(currentStroke);
        }
      } else {
        rs(currentStroke);
      }
    }
  } else {
    // No viewport: legacy path — world coord = canvas CSS pixel
    for (const s of strokes) renderStroke(ctx, s, dpr);
    if (currentStroke && currentStroke.points.length > 0) {
      if (shiftHeld) {
        ctx.globalAlpha = 0.22;
        renderStroke(ctx, currentStroke, dpr);
        ctx.globalAlpha = 1;
        const shape = detectShape(currentStroke.points);
        if (shape) {
          const snapped = shape.type === 'line'
            ? { ...currentStroke, shape: 'line' }
            : { ...currentStroke, shape: 'ellipse', cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
          renderStroke(ctx, snapped, dpr);
        } else {
          renderStroke(ctx, currentStroke, dpr);
        }
      } else {
        renderStroke(ctx, currentStroke, dpr);
      }
    }
  }
  ctx.restore();
}

// Generate a fit-to-content thumbnail from the raw stroke data.
// This renders all strokes centered and scaled to fill the thumbnail
// regardless of the current viewport pan/zoom position.
function generateThumbnail(canvas, w, h, paperBg = '#f5f0e8', strokes = null) {
  const tw = 400, th = 300;
  const tmp = document.createElement('canvas');
  tmp.width = tw; tmp.height = th;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = paperBg;
  ctx.fillRect(0, 0, tw, th);

  if (strokes && strokes.length > 0) {
    // Fit all stroke content into the thumbnail (viewport-independent)
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const s of strokes) {
      for (const p of (s.points || [])) {
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
      if (s.shape === 'ellipse' && s.cx != null) {
        minX = Math.min(minX, s.cx - s.rx); maxX = Math.max(maxX, s.cx + s.rx);
        minY = Math.min(minY, s.cy - s.ry); maxY = Math.max(maxY, s.cy + s.ry);
      }
    }
    if (isFinite(minX)) {
      const cW = maxX - minX || 1;
      const cH = maxY - minY || 1;
      const pad = Math.max(cW, cH) * 0.08;
      const tW  = cW + pad * 2;
      const tH  = cH + pad * 2;
      const sc  = Math.min(tw / tW, th / tH);
      const ox  = (tw - tW * sc) / 2 / sc - minX + pad;
      const oy  = (th - tH * sc) / 2 / sc - minY + pad;
      // Apply a fit-to-content transform: scale + center offset
      ctx.save();
      ctx.setTransform(sc, 0, 0, sc, (tw - tW * sc) / 2 - (minX - pad) * sc, (th - tH * sc) / 2 - (minY - pad) * sc);
      for (const s of strokes) renderStroke(ctx, s, 1);
      ctx.restore();
    }
  } else {
    // Fallback: copy current canvas content (legacy behavior)
    ctx.drawImage(canvas, 0, 0, tw, th);
  }
  return tmp.toDataURL('image/jpeg', 0.88);
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
  const canvasRef    = useRef(null);
  const cursorRef    = useRef(null);
  const containerRef = useRef(null);
  const curStroke    = useRef(null);
  const strokesRef   = useRef(strokes);
  const toolRef      = useRef(tool);
  const colorRef     = useRef(color);
  const sizeRef      = useRef(size);
  const logSizeRef   = useRef({ w: 0, h: 0 });
  const activePen    = useRef(false);
  const quickShapeTimer = useRef(null);
  const isDrawing    = useRef(false);
  const historyRef   = useRef([]);
  const futureRef    = useRef([]);

  // ── Viewport (pan + zoom) ────────────────────────────────────────────────────
  // viewportRef: canvas-level pan/zoom, applied via ctx.setTransform in redrawCanvas.
  // Logical coords (the canvas drawing space) are the same as before; we just
  // shift/scale where on screen they appear.
  const viewportRef  = useRef({ x: 0, y: 0, scale: 1 });

  // ── Multi-touch tracking for gesture detection ───────────────────────────────
  const touchPtrsRef = useRef(new Map()); // pointerId -> {x, y}
  const gestureRef   = useRef(null);      // {midX, midY, dist, vp} at gesture start
  const isGesturing  = useRef(false);
  const shiftRef     = useRef(false);     // true while Shift key is held

  // ── Hand tool pan tracking (mouse / pen / 1-finger with hand tool) ───────────
  const isPanning    = useRef(false);
  const panStartRef  = useRef(null); // {clientX, clientY, startVp}

  // Apply viewport: redraw canvas with ctx transform so strokes appear in the right
  // world-space position regardless of how far the user has panned.
  // The CSS transform on the wrapper is no longer used for drawing — only the
  // custom cursor circle uses container-relative coords (converted below).
  const applyViewport = useCallback(() => {
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    if (canvas && w > 0) {
      redrawCanvas(canvas.getContext('2d'), strokesRef.current, curStroke.current, w, h, DPR(), shiftRef.current, viewportRef.current);
    }
  }, []);

  // Convert a pointer event's screen coords to canvas logical coords.
  // The canvas element is inside the (transformed) wrapper, so
  // getBoundingClientRect() already accounts for the transform.
  // Dividing the offset by scale un-does the visual scaling.
  const getLogicalPos = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect  = canvas.getBoundingClientRect();
    const scale = viewportRef.current.scale;
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top)  / scale,
    };
  }, []);

  // Keep refs in sync with props
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);
  useEffect(() => { sizeRef.current = size; }, [size]);
  useEffect(() => {
    strokesRef.current = strokes;
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    if (!canvas || w === 0 || h === 0) return;
    const ctx = canvas.getContext('2d');
    redrawCanvas(ctx, strokes, null, w, h, DPR(), false, viewportRef.current);
  }, [strokes]);

  const onStrokesChangeRef = useRef(onStrokesChange);
  useEffect(() => { onStrokesChangeRef.current = onStrokesChange; }, [onStrokesChange]);

  // Resize canvas when container size changes
  useEffect(() => {
    const container = containerRef.current;
    const canvas    = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(entries => {
      const entry = entries[0];
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      if (w === 0 || h === 0) return;
      const dpr = DPR();
      canvas.width  = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width  = w + 'px';
      canvas.style.height = h + 'px';
      logSizeRef.current = { w, h };
      redrawCanvas(canvas.getContext('2d'), strokesRef.current, curStroke.current, w, h, dpr, false, viewportRef.current);
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  // ── Global pointermove ───────────────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e) => {
      // ── Gesture: 2-finger pan / pinch-zoom ──────────────────────────────────
      if (isGesturing.current && e.pointerType === 'touch' && touchPtrsRef.current.has(e.pointerId)) {
        touchPtrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const pts = [...touchPtrsRef.current.values()];
        if (pts.length >= 2) {
          const newMidX = (pts[0].x + pts[1].x) / 2;
          const newMidY = (pts[0].y + pts[1].y) / 2;
          const newDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
          const gs   = gestureRef.current;
          const rect = containerRef.current?.getBoundingClientRect();
          if (gs && rect) {
            // Scale: keep the same ratio as start, clamped
            const newScale = Math.min(8, Math.max(0.15, gs.vp.scale * newDist / gs.dist));
            // Pan: keep the midpoint anchored to the same canvas-logical point
            const midCanvasX = (gs.midX - rect.left - gs.vp.x) / gs.vp.scale;
            const midCanvasY = (gs.midY - rect.top  - gs.vp.y) / gs.vp.scale;
            const newX = (newMidX - rect.left) - midCanvasX * newScale;
            const newY = (newMidY - rect.top)  - midCanvasY * newScale;
            viewportRef.current = { x: newX, y: newY, scale: newScale };
            applyViewport();
          }
        }
        return;
      }

      // ── Hand tool pan (mouse / pen / single touch with hand tool) ───────────
      if (isPanning.current && panStartRef.current) {
        const { clientX: sx, clientY: sy, startVp } = panStartRef.current;
        viewportRef.current = {
          ...startVp,
          x: startVp.x + (e.clientX - sx),
          y: startVp.y + (e.clientY - sy),
        };
        applyViewport();
        return;
      }

      // ── Drawing cursor / stroke tracking ────────────────────────────────────
      if (e.pointerType === 'touch' && activePen.current) return;
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Compute world coords via viewport inverse (works anywhere on the infinite canvas)
      const cRect = containerRef.current?.getBoundingClientRect();
      if (!cRect) return;
      const { x: vx, y: vy, scale: vs } = viewportRef.current;
      const logX = (e.clientX - cRect.left - vx) / vs;
      const logY = (e.clientY - cRect.top  - vy) / vs;
      const { w, h } = logSizeRef.current;

      // Is the pointer inside the container bounds (for showing/hiding cursor)?
      const inContainer = e.clientX >= cRect.left && e.clientX <= cRect.right &&
                          e.clientY >= cRect.top  && e.clientY <= cRect.bottom;

      const el = cursorRef.current;
      if (el) {
        if ((inContainer || isDrawing.current) && toolRef.current !== 'hand') {
          // Convert world coords → container-relative CSS position
          const sz  = sizeRef.current * vs;
          const cx  = logX * vs + vx;
          const cy  = logY * vs + vy;
          el.style.display    = 'block';
          el.style.width      = sz + 'px';
          el.style.height     = sz + 'px';
          el.style.transform  = `translate(${cx - sz / 2}px, ${cy - sz / 2}px)`;
        } else {
          el.style.display = 'none';
        }
      }

      if (!isDrawing.current || !curStroke.current) return;
      curStroke.current.points.push({ x: logX, y: logY, p: e.pressure ?? 0.5 });
      redrawCanvas(canvas.getContext('2d'), strokesRef.current, curStroke.current, w, h, DPR(), shiftRef.current, viewportRef.current);
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, [applyViewport]);

  // ── Global pointerup / cancel ────────────────────────────────────────────────
  useEffect(() => {
    const finishStroke = (e) => {
      // Clean up touch tracking
      if (e.pointerType === 'touch') {
        touchPtrsRef.current.delete(e.pointerId);
        if (touchPtrsRef.current.size < 2) {
          isGesturing.current = false;
          gestureRef.current  = null;
        }
      }

      // Reset hand-tool pan state
      if (isPanning.current) {
        isPanning.current = false;
        panStartRef.current = null;
        if (canvasRef.current) canvasRef.current.style.cursor = toolRef.current === 'hand' ? 'grab' : 'none';
      }

      if (!isDrawing.current) return;
      isDrawing.current = false;
      activePen.current = false;
      const cur = curStroke.current;
      if (!cur) return;
      curStroke.current = null;

      if (quickShapeTimer.current) clearTimeout(quickShapeTimer.current);

      // Shape snapping only when Shift was held at the moment of release.
      // Without Shift the raw freehand stroke is always saved as-is.
      let finalStroke = cur;
      if (shiftRef.current) {
        const shape = detectShape(cur.points);
        if (shape) {
          if (shape.type === 'line') {
            finalStroke = { ...cur, shape: 'line' };
          } else if (shape.type === 'ellipse') {
            finalStroke = { ...cur, shape: 'ellipse', cx: shape.cx, cy: shape.cy, rx: shape.rx, ry: shape.ry };
          }
        }
      }

      if (finalStroke.points.length > 0) {
        historyRef.current.push(strokesRef.current);
        futureRef.current = [];
        const next = [...strokesRef.current, finalStroke];
        strokesRef.current = next;
        const canvas = canvasRef.current;
        const { w, h } = logSizeRef.current;
        const ctx = canvas?.getContext('2d');
        if (ctx) redrawCanvas(ctx, next, null, w, h, DPR(), false, viewportRef.current);
        onStrokesChangeRef.current?.(next, canvas, logSizeRef.current);
      }

      if (cursorRef.current) cursorRef.current.style.display = 'none';
    };
    window.addEventListener('pointerup',     finishStroke);
    window.addEventListener('pointercancel', finishStroke);
    return () => {
      window.removeEventListener('pointerup',     finishStroke);
      window.removeEventListener('pointercancel', finishStroke);
    };
  }, []);

  // Convert world coords → container-relative CSS coords for cursor overlay.
  // Since the wrapper no longer has a CSS transform, we apply the viewport here.
  const moveCursor = (worldX, worldY) => {
    const el = cursorRef.current;
    if (!el) return;
    const { x: vpX, y: vpY, scale: vpScale } = viewportRef.current;
    // Container CSS pixel = world * vpScale + vpOffset
    const cx = worldX * vpScale + vpX;
    const cy = worldY * vpScale + vpY;
    const sz = sizeRef.current * vpScale; // cursor ring scales with zoom
    el.style.display   = 'block';
    el.style.width     = sz + 'px';
    el.style.height    = sz + 'px';
    el.style.transform = `translate(${cx - sz / 2}px, ${cy - sz / 2}px)`;
  };

  const onPointerDown = (e) => {
    e.preventDefault();
    e.stopPropagation();

    // ── 2-finger touch: start gesture mode ──────────────────────────────────
    if (e.pointerType === 'touch') {
      touchPtrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (touchPtrsRef.current.size >= 2) {
        // Abort any in-progress stroke and switch to pan/zoom gesture
        isDrawing.current = false;
        curStroke.current = null;
        isGesturing.current = true;
        if (cursorRef.current) cursorRef.current.style.display = 'none';

        const pts  = [...touchPtrsRef.current.values()];
        const rect = containerRef.current?.getBoundingClientRect();
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
        gestureRef.current = { midX, midY, dist, vp: { ...viewportRef.current } };
        return;
      }
    }

    if (e.pointerType === 'touch' && activePen.current) return;
    if (e.pointerType === 'pen') activePen.current = true;

    // Only capture pointer for pen/mouse — capturing touch pointers routes their
    // events exclusively to the canvas element, bypassing the global window listener
    // that tracks both fingers for pinch-zoom, which breaks multi-touch gestures.
    if (e.pointerType !== 'touch') {
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
    }

    // ── Hand tool: pan the viewport instead of drawing ───────────────────────
    if (toolRef.current === 'hand') {
      isPanning.current = true;
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, startVp: { ...viewportRef.current } };
      if (cursorRef.current) cursorRef.current.style.display = 'none';
      if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
      return;
    }

    const pos = getLogicalPos(e);
    isDrawing.current = true;
    curStroke.current = {
      tool:   toolRef.current,
      color:  colorRef.current,
      size:   sizeRef.current,
      points: [{ x: pos.x, y: pos.y, p: e.pressure ?? 0.5 }],
    };
    moveCursor(pos.x, pos.y);
  };

  const onPointerMove = (e) => {
    if (toolRef.current === 'hand') return; // global handler covers pan
    const pos = getLogicalPos(e);
    moveCursor(pos.x, pos.y);
    if (!isDrawing.current || !curStroke.current) return;
    if (e.pointerType === 'touch' && activePen.current) return;
    curStroke.current.points.push({ x: pos.x, y: pos.y, p: e.pressure ?? 0.5 });
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    redrawCanvas(canvas.getContext('2d'), strokesRef.current, curStroke.current, w, h, DPR(), shiftRef.current, viewportRef.current);
  };

  const onPointerLeave = () => {
    if (cursorRef.current) cursorRef.current.style.display = 'none';
  };

  const applyStrokes = (next) => {
    strokesRef.current = next;
    const canvas = canvasRef.current;
    const { w, h } = logSizeRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) redrawCanvas(ctx, next, null, w, h, DPR(), false, viewportRef.current);
    onStrokesChangeRef.current?.(next, canvas, logSizeRef.current);
  };

  const handleUndo  = () => { if (historyRef.current.length === 0) return; futureRef.current.push(strokesRef.current); applyStrokes(historyRef.current.pop()); };
  const handleRedo  = () => { if (futureRef.current.length === 0)  return; historyRef.current.push(strokesRef.current); applyStrokes(futureRef.current.pop()); };
  const handleClear = () => { if (strokesRef.current.length === 0) return; historyRef.current.push(strokesRef.current); futureRef.current = []; applyStrokes([]); };

  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo(); else handleUndo();
      }
      // Shift held: switch to shape-preview mode while drawing
      if (e.key === 'Shift' && !e.repeat && !shiftRef.current) {
        shiftRef.current = true;
        if (isDrawing.current && curStroke.current) {
          const canvas = canvasRef.current;
          const { w, h } = logSizeRef.current;
          if (canvas) redrawCanvas(canvas.getContext('2d'), strokesRef.current, curStroke.current, w, h, DPR(), true, viewportRef.current);
        }
      }
    };
    const onKeyUp = (e) => {
      if (e.key === 'Shift') {
        shiftRef.current = false;
        // Revert to raw freehand preview when shift released mid-stroke
        if (isDrawing.current && curStroke.current) {
          const canvas = canvasRef.current;
          const { w, h } = logSizeRef.current;
          if (canvas) redrawCanvas(canvas.getContext('2d'), strokesRef.current, curStroke.current, w, h, DPR(), false, viewportRef.current);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup',   onKeyUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={containerRef} style={{
      position: 'relative', width: '100%', height: '100%', overflow: 'hidden', borderRadius: 6,
      touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
      // Paper dot grid — purely decorative, never baked into canvas
      background: paperBg,
      backgroundImage: `radial-gradient(circle, ${paperDots} 1px, transparent 1px)`,
      backgroundSize: '20px 20px',
    }}>
      {/* Canvas fills the full container — viewport is applied via ctx.setTransform */}
      <canvas
        ref={canvasRef}
        style={{
          display: 'block', position: 'absolute', top: 0, left: 0,
          cursor: tool === 'hand' ? 'grab' : 'none',
          userSelect: 'none', touchAction: 'none',
        }}
        onPointerDown={onPointerDown}
        onPointerLeave={onPointerLeave}
      />
      {/* Custom cursor circle — container-relative, converted from world coords in moveCursor */}
      <div
        ref={cursorRef}
        style={{
          display: 'none', position: 'absolute', top: 0, left: 0,
          borderRadius: '50%', border: '1.5px solid rgba(0,0,0,0.5)',
          background: 'rgba(0,0,0,0.08)', pointerEvents: 'none',
          zIndex: 10, boxSizing: 'border-box',
        }}
      />

      {/* ── Left controls: stays at fixed position regardless of viewport ── */}
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
      {/* Hand / Pan tool — leftmost, before brush */}
      <button
        onPointerDown={e => { e.stopPropagation(); setTool('hand'); }}
        style={{
          ...pillBtnStyle(dark),
          border: tool === 'hand'
            ? dark ? '2px solid rgba(255,255,255,0.6)' : '2px solid rgba(0,0,0,0.5)'
            : dark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.12)',
          background: tool === 'hand'
            ? dark ? 'rgba(90,80,68,0.98)' : 'rgba(255,255,255,0.95)'
            : undefined,
        }}
        title="Pan canvas"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 11V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2"/>
          <path d="M14 10V4a2 2 0 0 0-2-2 2 2 0 0 0-2 2v2"/>
          <path d="M10 10.5V6a2 2 0 0 0-2-2 2 2 0 0 0-2 2v8"/>
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>
        </svg>
      </button>

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
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
          <path d="m15 5 4 4"/>
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
        {/* Lucide eraser icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/>
          <path d="M22 21H7"/>
          <path d="m5 11 9 9"/>
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
const STRIP_W = 88;   // card width
const STRIP_H = 68;   // canvas preview height inside card
const STRIP_LABEL = 20; // title bar height

const PAPER_LIGHT = '#f5f0e8';
const PAPER_DARK  = '#433c34';
const DOTS_LIGHT  = 'rgba(0,0,0,0.13)';
const DOTS_DARK   = 'rgba(255,255,255,0.18)';

function DrawingStrip({ drawings, selectedId, onSelect, onCreate, isLoading, dark, strokesCache }) {
  const paperBg   = dark ? PAPER_DARK  : PAPER_LIGHT;
  const paperDots = dark ? DOTS_DARK   : DOTS_LIGHT;
  const paperBgStyle = {
    background: paperBg,
    backgroundImage: `radial-gradient(circle, ${paperDots} 1px, transparent 1px)`,
    backgroundSize: '14px 14px',
  };

  return (
    <div style={{
      display: 'flex', gap: 6, padding: '4px 0 10px 0', overflowX: 'auto',
      alignItems: 'flex-start', flexShrink: 0,
      scrollbarWidth: 'none', msOverflowStyle: 'none',
    }}>
      {/* New drawing button — card-shaped */}
      <button
        onClick={onCreate}
        title="New drawing"
        style={{
          flexShrink: 0,
          width: STRIP_W,
          height: STRIP_H + STRIP_LABEL,
          borderRadius: 8,
          border: dark ? '1.5px dashed rgba(255,255,255,0.2)' : '1.5px dashed rgba(0,0,0,0.22)',
          background: 'transparent', cursor: 'pointer',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 4,
          color: dark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.35)',
          transition: 'border-color 0.15s, opacity 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
        onMouseLeave={e => e.currentTarget.style.opacity = '1'}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase' }}>new</span>
      </button>

      {isLoading && (
        <span style={{ fontSize: F.xs, color: 'var(--dl-middle)', fontFamily: mono, padding: '0 4px', alignSelf: 'center' }}>loading…</span>
      )}

      {drawings.map(d => {
        const selected = selectedId === d.id;
        return (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            title={d.title}
            style={{
              flexShrink: 0, padding: 0,
              width: STRIP_W,
              height: STRIP_H + STRIP_LABEL,
              borderRadius: 8,
              border: selected
                ? '2px solid var(--dl-accent, #4EC9B0)'
                : dark ? '1.5px solid rgba(255,255,255,0.13)' : '1.5px solid rgba(0,0,0,0.13)',
              cursor: 'pointer', overflow: 'hidden',
              display: 'flex', flexDirection: 'column',
              background: 'transparent',
              boxShadow: selected ? '0 0 0 1px var(--dl-accent, #4EC9B0)22' : 'none',
              transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.15s',
            }}
            onMouseEnter={e => { if (!selected) e.currentTarget.style.opacity = '0.8'; }}
            onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
          >
            {/* Live stroke preview */}
            <div style={{ width: '100%', height: STRIP_H, position: 'relative', overflow: 'hidden', ...paperBgStyle }}>
              <MiniDrawingCanvas strokes={strokesCache?.[d.id] || []} dark={dark} />
            </div>
            {/* Title bar */}
            <div style={{
              width: '100%', height: STRIP_LABEL, flexShrink: 0,
              background: dark ? 'rgba(30,24,20,0.92)' : 'rgba(245,240,232,0.95)',
              display: 'flex', alignItems: 'center', padding: '0 6px',
              fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
              color: selected
                ? 'var(--dl-accent, #4EC9B0)'
                : dark ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)',
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              borderTop: dark ? '1px solid rgba(255,255,255,0.07)' : '1px solid rgba(0,0,0,0.08)',
              transition: 'color 0.15s',
            }}>
              {d.title || 'Untitled'}
            </div>
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
  const [renameError, setRenameError] = useState(null);
  const inputRef = useRef(null);
  const editingRef = useRef(false);

  // Keep editingRef in sync so the title-change effect can read it synchronously
  useEffect(() => { editingRef.current = editing; }, [editing]);

  // Sync draft when title prop changes — but NEVER cancel an active edit
  useEffect(() => {
    if (!editingRef.current) setDraft(title);
  }, [title]);

  // Focus + select after React commits the input to DOM.
  // setTimeout(0) ensures we're past any concurrent-mode batched renders.
  useEffect(() => {
    if (!editing) return;
    const id = setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
        console.log('[DrawingTitleEditor] input focused, draft=', draft);
      } else {
        console.warn('[DrawingTitleEditor] editing=true but inputRef is null after timeout');
      }
    }, 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const commit = async () => {
    const trimmed = draft.trim() || 'Untitled';
    setDraft(trimmed);
    setEditing(false);
    setRenameError(null);
    if (trimmed !== title) {
      console.log('[DrawingTitleEditor] committing rename:', title, '→', trimmed);
      try {
        await onRename(trimmed);
      } catch (e) {
        console.error('[DrawingTitleEditor] rename failed:', e);
        setRenameError('Rename failed');
        setTimeout(() => setRenameError(null), 3000);
      }
    }
  };

  const startEditing = (e) => {
    e.stopPropagation();
    console.log('[DrawingTitleEditor] startEditing clicked, current title=', title);
    setEditing(true);
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
    <div style={{ position: 'relative' }}>
      <div
        onClick={startEditing}
        onPointerDown={startEditing}
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
      {renameError && (
        <span style={{
          fontFamily: mono, fontSize: 10, color: 'rgba(200,60,60,0.85)',
          letterSpacing: '0.04em', position: 'absolute', left: 0, top: '100%',
        }}>{renameError}</span>
      )}
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
  const [strokesCache, setStrokesCache] = useState({}); // { [drawingId]: strokes[] }
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
      strokes: d.strokes || [],
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
          loadDrawing(list[0].id).then(() => {
            // After the first drawing is loaded, batch-fetch remaining strokes for strip previews
            const rest = list.slice(1);
            if (!rest.length) return;
            Promise.allSettled(rest.map(dr => api.get(`/api/drawings?id=${dr.id}`, token)))
              .then(results => {
                const updates = {};
                results.forEach((r, i) => {
                  if (r.status === 'fulfilled' && r.value?.drawing?.strokes) {
                    updates[rest[i].id] = r.value.drawing.strokes;
                  }
                });
                if (Object.keys(updates).length) setStrokesCache(prev => ({ ...prev, ...updates }));
              });
          });
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
      // Cache strokes for strip preview
      setStrokesCache(prev => ({ ...prev, [drawing.id]: drawing.strokes ?? [] }));
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
      setStrokesCache(prev => ({ ...prev, [drawing.id]: [] }));
    } catch (e) {
      console.error('create drawing error', e);
      showToast('Failed to create drawing');
    }
  };

  const handleRenameDrawing = useCallback(async (newTitle) => {
    const id = selectedIdRef.current;
    console.log('[DrawingsCard] handleRenameDrawing id=', id, 'newTitle=', newTitle, 'hasToken=', !!token);
    if (!id || !token) {
      console.warn('[DrawingsCard] rename aborted — missing id or token');
      throw new Error('Missing id or token');
    }
    setTitle(newTitle);
    setDrawings(prev => prev.map(d => d.id === id ? { ...d, title: newTitle } : d));
    try {
      const result = await api.patch('/api/drawings', { id, title: newTitle }, token);
      console.log('[DrawingsCard] rename success:', result);
    } catch (e) {
      console.error('[DrawingsCard] rename drawing error:', e);
      throw e; // propagate so DrawingTitleEditor can show error state
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
    // Keep strip preview in sync with live strokes
    setStrokesCache(prev => prev[id] === nextStrokes ? prev : { ...prev, [id]: nextStrokes });

    enqueue(async () => {
      let thumbnail = null;
      if (logSize.w > 0) {
        // Pass strokes directly so the thumbnail fits all content (viewport-independent)
        thumbnail = generateThumbnail(canvas, logSize.w, logSize.h, paperBgRef.current, nextStrokes);
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
    <div data-no-page-swipe>
      <Card label="🖼️ Drawings" color={CARD_COLOR} collapsed={false} autoHeight expandHref="/drawings">
        <DrawingStrip
          drawings={drawings}
          selectedId={selectedId}
          onSelect={loadDrawing}
          onCreate={createDrawing}
          isLoading={isLoading}
          dark={dark}
          strokesCache={strokesCache}
        />
        <DrawingTitleEditor title={title} onRename={handleRenameDrawing} />
        <div style={{ position: 'relative', width: '100%', aspectRatio: '1/1', flexShrink: 0 }}>
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
    </div>
  );
}
