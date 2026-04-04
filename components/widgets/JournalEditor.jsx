"use client";
import { useState, useEffect, useRef, useCallback, useContext, useMemo, Fragment } from "react";
import { mono, serif, F, R, projectColor } from "@/lib/tokens";
import { useDbSave } from "@/lib/db";
import { useTheme } from "@/lib/theme";
import { NoteContext, ProjectNamesContext, PlaceNamesContext, NavigationContext } from "@/lib/contexts";
import { RichLine, Shimmer, SourceBadge } from "../ui/primitives.jsx";
import { estimateNutrition, uploadImageFile, deleteImageFile } from "@/lib/images";
import { api } from "@/lib/api";
import { todayKey } from "@/lib/dates";
import { DayLabEditor } from "../Editor.jsx";

// Strip image chip spans (which may contain nested child spans) from HTML.
// Uses balanced-tag counting since the chip's renderHTML creates nested spans.
export function stripImageChips(html) {
  if (!html) return '';
  let result = '', i = 0;
  while (i < html.length) {
    if (html.slice(i, i + 5) === '<span') {
      const tagEnd = html.indexOf('>', i);
      if (tagEnd === -1) break;
      const tag = html.slice(i, tagEnd + 1);
      if (tag.includes('data-image-chip=')) {
        // Found a chip — skip it by counting nested span open/close
        let depth = 1, j = tagEnd + 1;
        while (j < html.length && depth > 0) {
          if (html.slice(j, j + 5) === '<span') {
            depth++;
            const e = html.indexOf('>', j);
            j = e >= 0 ? e + 1 : j + 1;
          } else if (html.slice(j, j + 7) === '</span>') {
            depth--; j += 7;
          } else { j++; }
        }
        while (j < html.length && html[j] === ' ') j++;
        i = j; continue;
      }
    }
    result += html[i]; i++;
  }
  return result;
}

// Extract drawing tag titles from journal/note content
export function extractDrawingTags(content) {
  if (!content) return [];
  const titles = [];
  const re = /data-drawing-tag="([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) titles.push(m[1]);
  return [...new Set(titles)];
}

// Extract place tag names from journal/note content
export function extractPlaceTags(content) {
  if (!content) return [];
  const names = [];
  const re = /data-place-tag="([^"]+)"/g;
  let m;
  while ((m = re.exec(content)) !== null) names.push(m[1].trim());
  return [...new Set(names)];
}

// Extract image URLs from journal/note content
export function extractImages(content) {
  if (!content) return [];
  const urls = [];
  let m;
  // Image chip format (inline spans)
  const chipRe = /data-image-chip="([^"]+)"/g;
  while ((m = chipRe.exec(content)) !== null) urls.push(m[1]);
  // Legacy: [img:url] text format
  const txtRe = /\[img:(https?:\/\/[^\]]+)\]/g;
  while ((m = txtRe.exec(content)) !== null) urls.push(m[1]);
  // Legacy: HTML imageblock format
  const htmlRe = /data-imageblock="([^"]+)"/g;
  while ((m = htmlRe.exec(content)) !== null) urls.push(m[1]);
  return [...new Set(urls)];
}

// ── Photo Strip ───────────────────────────────────────────────────────────────
// Horizontal scroll row. Click opens slideshow. Drag to reorder (requires 8px
// movement threshold so clicks aren't intercepted). Dragged photo follows
// cursor as a ghost; remaining items shift to preview the new order.
const SIZE = 140;
const GAP = 4;
const DRAG_THRESHOLD = 8; // px of movement before drag activates

export function PhotoStrip({ images, onViewImage, onReorder }) {
  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(false);   // true once threshold exceeded
  const [dragIdx, setDragIdx] = useState(null);       // index being dragged
  const [overIdx, setOverIdx] = useState(null);        // drop target index
  const [cursorX, setCursorX] = useState(0);
  const [cursorY, setCursorY] = useState(0);
  const pendingRef = useRef(null); // { idx, pointerId, startX, startY }

  if (!images.length) return null;
  const canReorder = !!onReorder && images.length > 1;

  // Build display order: move dragIdx item to overIdx position
  let displayOrder = images.map((url, i) => ({ url, orig: i }));
  if (dragging && dragIdx != null && overIdx != null && dragIdx !== overIdx) {
    const item = displayOrder[dragIdx];
    displayOrder = displayOrder.filter((_, i) => i !== dragIdx);
    displayOrder.splice(overIdx, 0, item);
  }

  const calcOverIdx = (clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const relX = clientX - rect.left + (containerRef.current?.scrollLeft || 0);
    return Math.max(0, Math.min(images.length - 1, Math.floor(relX / (SIZE + GAP))));
  };

  const handlePointerDown = (e, i) => {
    if (!canReorder) return;
    e.preventDefault();
    pendingRef.current = { idx: i, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const p = pendingRef.current;
    if (!p && !dragging) return;

    // Not yet dragging — check threshold
    if (p && !dragging) {
      const dx = e.clientX - p.startX;
      const dy = e.clientY - p.startY;
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      // Threshold exceeded — activate drag
      setDragging(true);
      setDragIdx(p.idx);
      setOverIdx(p.idx);
      pendingRef.current = null;
    }

    setCursorX(e.clientX);
    setCursorY(e.clientY);
    setOverIdx(calcOverIdx(e.clientX));
  };

  const handlePointerUp = (e) => {
    const wasPending = pendingRef.current;
    const wasDragging = dragging;

    // Release pointer capture
    if (wasPending?.pointerId != null) {
      try { containerRef.current?.releasePointerCapture(wasPending.pointerId); } catch {}
    }

    // Commit reorder
    if (wasDragging && dragIdx != null && overIdx != null && dragIdx !== overIdx && onReorder) {
      const arr = [...images];
      const [moved] = arr.splice(dragIdx, 1);
      arr.splice(overIdx, 0, moved);
      onReorder(arr);
    }

    // If it was a click (no drag activated), open slideshow
    if (wasPending && !wasDragging) {
      onViewImage(wasPending.idx);
    }

    pendingRef.current = null;
    setDragging(false);
    setDragIdx(null);
    setOverIdx(null);
  };

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        display: 'flex', gap: GAP, overflowX: dragging ? 'hidden' : 'auto', overflowY: 'hidden',
        marginBottom: 12, borderRadius: 10,
        scrollbarWidth: 'none', msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
        userSelect: 'none', position: 'relative',
        touchAction: dragging ? 'none' : 'pan-x',
      }}
    >
      {displayOrder.map(({ url, orig }) => {
        const isDragged = dragging && orig === dragIdx;
        return (
          <div
            key={url}
            onPointerDown={canReorder ? e => handlePointerDown(e, orig) : undefined}
            onClick={!canReorder ? () => onViewImage(images.indexOf(url)) : undefined}
            style={{
              width: SIZE, height: SIZE, flexShrink: 0,
              borderRadius: 10, overflow: 'hidden',
              cursor: dragging ? 'grabbing' : 'pointer',
              background: 'var(--dl-well)',
              opacity: isDragged ? 0.25 : 1,
              transition: dragging ? 'transform 0.2s ease, opacity 0.15s' : 'none',
            }}
            onMouseEnter={e => { if (!dragging) e.currentTarget.style.opacity = '0.85'; }}
            onMouseLeave={e => { if (!dragging) e.currentTarget.style.opacity = '1'; }}
          >
            <img src={url} alt="" loading="lazy" draggable="false" style={{
              width: '100%', height: '100%', objectFit: 'cover', display: 'block',
              pointerEvents: 'none',
            }} />
          </div>
        );
      })}

      {/* Floating drag ghost */}
      {dragging && dragIdx != null && (
        <div style={{
          position: 'fixed',
          left: cursorX - SIZE / 2,
          top: cursorY - SIZE / 2,
          width: SIZE, height: SIZE,
          borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
          opacity: 0.85, pointerEvents: 'none',
          zIndex: 9999, transform: 'scale(1.08)',
        }}>
          <img src={images[dragIdx]} alt="" draggable="false" style={{
            width: '100%', height: '100%', objectFit: 'cover', display: 'block',
          }} />
        </div>
      )}
    </div>
  );
}

// ── Slideshow ─────────────────────────────────────────────────────────────────
// Wide rectangle with chevrons, dots, and X to close.
export function Slideshow({ images, index, onClose }) {
  const [idx, setIdx] = useState(index);
  const pointerStart = useRef(null);

  const prev = () => setIdx(i => (i - 1 + images.length) % images.length);
  const next = () => setIdx(i => (i + 1) % images.length);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // Unified pointer (mouse + touch) swipe
  const onPointerDown = (e) => { pointerStart.current = e.clientX; };
  const onPointerUp = (e) => {
    if (pointerStart.current == null) return;
    const diff = e.clientX - pointerStart.current;
    if (Math.abs(diff) > 40) { diff > 0 ? prev() : next(); }
    pointerStart.current = null;
  };

  return (
    <div style={{ marginBottom: 12, position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--dl-well)', cursor: 'grab', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      <img src={images[idx]} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'contain', display: 'block' }} />

      {/* Left chevron */}
      {images.length > 1 && (
        <div onClick={prev} style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        >
          <span style={{ fontSize: 22, fontFamily: mono, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>‹</span>
        </div>
      )}

      {/* Right chevron */}
      {images.length > 1 && (
        <div onClick={next} style={{
          position: 'absolute', right: 0, top: 0, bottom: 0, width: 48,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'color 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        >
          <span style={{ fontSize: 22, fontFamily: mono, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>›</span>
        </div>
      )}

      {/* Close X — top right, above chevrons */}
      <button onClick={e => { e.stopPropagation(); onClose(); }} style={{
        position: 'absolute', top: 8, right: 8, zIndex: 2,
        background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: 100,
        width: 28, height: 28, cursor: 'pointer',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'rgba(255,255,255,0.6)', transition: 'color 0.15s, background 0.15s',
      }}
        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Dots */}
      {images.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
          {images.map((_, i) => (
            <div key={i} onClick={() => setIdx(i)} style={{
              width: 6, height: 6, borderRadius: '50%', cursor: 'pointer',
              background: i === idx ? '#fff' : 'rgba(255,255,255,0.35)',
              transition: 'background 0.2s',
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drawing paper helpers ─────────────────────────────────────────────────────
const PAPER_LIGHT = '#f5f0e8';
const PAPER_DARK  = '#433c34';
const DOTS_LIGHT  = 'rgba(0,0,0,0.13)';
const DOTS_DARK   = 'rgba(255,255,255,0.18)';

function paperStyle(dark) {
  const bg   = dark ? PAPER_DARK : PAPER_LIGHT;
  const dots = dark ? DOTS_DARK  : DOTS_LIGHT;
  return {
    background: bg,
    backgroundImage: `radial-gradient(circle, ${dots} 1px, transparent 1px)`,
    backgroundSize: '14px 14px',
  };
}

// ── MiniLocationMap — SVG map showing tagged location pins ────────────────────
// Renders an equirectangular projection auto-zoomed to fit all pins.
// Design language mirrors WorldMapCard: deep navy bg, teal grid, colored pins.
function MiniLocationMap({ places }) {
  if (!places || places.length === 0) return null;

  const lats = places.map(p => p.lat);
  const lngs = places.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  // Add padding; minimum ±12° so a single pin doesn't fill the whole view
  const latSpan = Math.max(maxLat - minLat, 24);
  const lngSpan = Math.max(maxLng - minLng, 24);
  const latPad = latSpan * 0.35;
  const lngPad = lngSpan * 0.35;
  const vMinLat = Math.max(-85, minLat - latPad);
  const vMaxLat = Math.min(85, maxLat + latPad);
  const vMinLng = Math.max(-180, minLng - lngPad);
  const vMaxLng = Math.min(180, maxLng + lngPad);

  const proj = (lat, lng) => ({
    x: ((lng - vMinLng) / (vMaxLng - vMinLng) * 100).toFixed(2) + '%',
    y: ((vMaxLat - lat) / (vMaxLat - vMinLat) * 100).toFixed(2) + '%',
  });

  // Grid lines within the view window
  const latLines = [-60, -30, 0, 30, 60].filter(l => l > vMinLat && l < vMaxLat);
  const lngLines = [-120, -60, 0, 60, 120].filter(l => l > vMinLng && l < vMaxLng);

  return (
    <div style={{ width: '100%', height: '100%', background: '#0d1a24', position: 'relative', overflow: 'hidden', borderRadius: 8 }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}>
        {/* Latitude grid lines */}
        {latLines.map(lat => {
          const y = ((vMaxLat - lat) / (vMaxLat - vMinLat) * 100).toFixed(2);
          return <line key={'lat'+lat} x1="0" y1={y+'%'} x2="100%" y2={y+'%'} stroke="rgba(80,200,220,0.12)" strokeWidth="0.5" />;
        })}
        {/* Equator — slightly brighter */}
        {0 > vMinLat && 0 < vMaxLat && (
          <line x1="0" y1={((vMaxLat) / (vMaxLat - vMinLat) * 100).toFixed(2)+'%'} x2="100%" y2={((vMaxLat) / (vMaxLat - vMinLat) * 100).toFixed(2)+'%'} stroke="rgba(80,200,220,0.22)" strokeWidth="0.8" />
        )}
        {/* Longitude grid lines */}
        {lngLines.map(lng => {
          const x = ((lng - vMinLng) / (vMaxLng - vMinLng) * 100).toFixed(2);
          return <line key={'lng'+lng} x1={x+'%'} y1="0" x2={x+'%'} y2="100%" stroke="rgba(80,200,220,0.12)" strokeWidth="0.5" />;
        })}

        {/* Location pins */}
        {places.map((p, i) => {
          const pos = proj(p.lat, p.lng);
          const color = p.color || '#4EC9B0';
          return (
            <g key={i}>
              {/* Outer pulse ring */}
              <circle cx={pos.x} cy={pos.y} r="6" fill="none" stroke={color} strokeWidth="1" opacity="0.35" />
              {/* Pin dot */}
              <circle cx={pos.x} cy={pos.y} r="3.5" fill={color} opacity="0.92" />
              {/* Name label */}
              <text
                x={pos.x} y={pos.y}
                dx="7" dy="4"
                fill="rgba(200,230,240,0.75)"
                fontSize="8.5"
                fontFamily="ui-monospace, monospace"
                style={{ userSelect: 'none', pointerEvents: 'none' }}
              >{p.name}</text>
            </g>
          );
        })}
      </svg>

      {/* "LOCATIONS" label — top-left corner, WorldMapCard style */}
      <div style={{
        position: 'absolute', top: 6, left: 8,
        fontFamily: 'ui-monospace, monospace', fontSize: 8, letterSpacing: '0.12em',
        textTransform: 'uppercase', color: 'rgba(80,200,220,0.45)',
        pointerEvents: 'none',
      }}>Locations</div>
    </div>
  );
}

// ── MediaStrip — photos + drawing mini-cards in one horizontal row ─────────────
// Photos support drag-to-reorder; drawing tiles are click-only.
// mediaItems: Array<{type:'photo',url:string}|{type:'drawing',title:string,thumbnail:string}>
// onViewItem(idx): called with the index into mediaItems
// onReorderPhotos(newPhotoUrls): called when photos are reordered (drawings stay in place)
function MediaStrip({ mediaItems, onViewItem, onReorderPhotos, dark }) {
  const containerRef = useRef(null);
  const [dragging, setDragging]   = useState(false);
  const [dragIdx, setDragIdx]     = useState(null);
  const [overIdx, setOverIdx]     = useState(null);
  const [cursorX, setCursorX]     = useState(0);
  const [cursorY, setCursorY]     = useState(0);
  const pendingRef = useRef(null);

  if (!mediaItems.length) return null;

  // Only photo items can be reordered
  const photoItems = mediaItems.filter(i => i.type === 'photo');
  const canReorder = !!onReorderPhotos && photoItems.length > 1;

  // Build display order for photos within their sub-array (other items stay fixed)
  // We apply reordering display only to photo slots
  const photoDisplayMap = photoItems.map((_, i) => i); // identity unless dragging
  let reorderedPhotoMap = [...photoDisplayMap];
  if (dragging && dragIdx != null && overIdx != null && dragIdx !== overIdx) {
    const moved = reorderedPhotoMap.splice(dragIdx, 1)[0];
    reorderedPhotoMap.splice(overIdx, 0, moved);
  }

  // Map photo drag indices (within photos-only) to full mediaItems indices
  let photoMediaIdx = 0;
  const photoMediaIndices = mediaItems.map((item, i) => item.type === 'photo' ? i : null).filter(i => i !== null);

  const calcOverIdx = (clientX) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const relX = clientX - rect.left + (containerRef.current?.scrollLeft || 0);
    return Math.max(0, Math.min(photoItems.length - 1, Math.floor(relX / (SIZE + GAP))));
  };

  const handlePointerDown = (e, photoIdx) => {
    if (!canReorder) return;
    e.preventDefault();
    pendingRef.current = { idx: photoIdx, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY };
    containerRef.current?.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e) => {
    const p = pendingRef.current;
    if (!p && !dragging) return;
    if (p && !dragging) {
      if (Math.abs(e.clientX - p.startX) < DRAG_THRESHOLD && Math.abs(e.clientY - p.startY) < DRAG_THRESHOLD) return;
      setDragging(true); setDragIdx(p.idx); setOverIdx(p.idx);
      pendingRef.current = null;
    }
    setCursorX(e.clientX); setCursorY(e.clientY);
    setOverIdx(calcOverIdx(e.clientX));
  };

  const handlePointerUp = (e) => {
    const wasPending = pendingRef.current;
    const wasDragging = dragging;
    if (wasPending?.pointerId != null) {
      try { containerRef.current?.releasePointerCapture(wasPending.pointerId); } catch {}
    }
    if (wasDragging && dragIdx != null && overIdx != null && dragIdx !== overIdx && onReorderPhotos) {
      const arr = photoItems.map(i => i.url);
      const [moved] = arr.splice(dragIdx, 1);
      arr.splice(overIdx, 0, moved);
      onReorderPhotos(arr);
    }
    if (wasPending && !wasDragging) {
      // click on photo — find its full mediaItems index
      const mediaIdx = photoMediaIndices[wasPending.idx] ?? wasPending.idx;
      onViewItem(mediaIdx);
    }
    pendingRef.current = null;
    setDragging(false); setDragIdx(null); setOverIdx(null);
  };

  // Build rendered list: photos in (possibly reordered) display order, drawings at their positions
  let photoSlot = 0;
  const renderedItems = mediaItems.map((item, mediaIdx) => {
    if (item.type === 'photo') {
      const pIdx = photoSlot++;
      const displayPIdx = reorderedPhotoMap.indexOf(pIdx);
      const isDragged = dragging && pIdx === dragIdx;
      return (
        <div
          key={'photo-' + mediaIdx}
          onPointerDown={canReorder ? e => handlePointerDown(e, pIdx) : undefined}
          onClick={!canReorder ? () => onViewItem(mediaIdx) : undefined}
          style={{
            width: SIZE, height: SIZE, flexShrink: 0, borderRadius: 10, overflow: 'hidden',
            cursor: dragging ? 'grabbing' : 'pointer', background: 'var(--dl-well)',
            opacity: isDragged ? 0.25 : 1,
            transition: dragging ? 'transform 0.2s ease, opacity 0.15s' : 'none',
          }}
          onMouseEnter={e => { if (!dragging) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { if (!dragging) e.currentTarget.style.opacity = '1'; }}
        >
          <img src={item.url} alt="" loading="lazy" draggable="false"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
        </div>
      );
    }

    // Map mini-card
    if (item.type === 'map') {
      return (
        <div
          key="map"
          onPointerDown={e => { e.stopPropagation(); e.currentTarget._tapStart = { x: e.clientX, y: e.clientY }; }}
          onPointerUp={e => {
            e.stopPropagation();
            const s = e.currentTarget._tapStart;
            if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_THRESHOLD * 2) onViewItem(mediaIdx);
          }}
          style={{
            width: SIZE, height: SIZE, flexShrink: 0, borderRadius: 10, overflow: 'hidden',
            cursor: 'pointer', position: 'relative', background: '#0d1a24',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          <MiniLocationMap places={item.places} />
        </div>
      );
    }

    // Drawing mini-card
    // Use pointer events (not onClick) so taps fire reliably even when the
    // parent container has pointer-capture set for photo drag-reorder.
    return (
      <div
        key={'drawing-' + mediaIdx}
        onPointerDown={e => { e.stopPropagation(); e.currentTarget._tapStart = { x: e.clientX, y: e.clientY }; }}
        onPointerUp={e => {
          e.stopPropagation();
          const s = e.currentTarget._tapStart;
          if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < DRAG_THRESHOLD * 2) onViewItem(mediaIdx);
        }}
        style={{
          width: SIZE, height: SIZE, flexShrink: 0, borderRadius: 10, overflow: 'hidden',
          cursor: 'pointer', position: 'relative',
          ...paperStyle(dark),
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
      >
        {/* objectFit:cover fills the square cleanly — thumbnail has paper bg baked in */}
        <img src={item.thumbnail} alt={item.title} loading="lazy" draggable="false"
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
        {/* Title bar at bottom */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          background: dark ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.55)',
          padding: '3px 6px',
          fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: dark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>{item.title}</div>
      </div>
    );
  });

  return (
    <div
      ref={containerRef}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      style={{
        display: 'flex', gap: GAP, overflowX: dragging ? 'hidden' : 'auto', overflowY: 'hidden',
        marginBottom: 12, borderRadius: 10,
        scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch',
        userSelect: 'none', position: 'relative',
        touchAction: dragging ? 'none' : 'pan-x',
      }}
    >
      {renderedItems}

      {/* Drag ghost for photo */}
      {dragging && dragIdx != null && (
        <div style={{
          position: 'fixed', left: cursorX - SIZE / 2, top: cursorY - SIZE / 2,
          width: SIZE, height: SIZE, borderRadius: 10, overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)', opacity: 0.85, pointerEvents: 'none',
          zIndex: 9999, transform: 'scale(1.08)',
        }}>
          <img src={photoItems[dragIdx]?.url} alt="" draggable="false"
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        </div>
      )}
    </div>
  );
}

// ── MediaSlideshow — carousel that handles both photos and drawing mini-cards ──
function MediaSlideshow({ mediaItems, index, onClose, dark }) {
  const [idx, setIdx] = useState(index);
  const pointerStart = useRef(null);

  const prev = () => setIdx(i => (i - 1 + mediaItems.length) % mediaItems.length);
  const next = () => setIdx(i => (i + 1) % mediaItems.length);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const onPointerDown = (e) => { pointerStart.current = e.clientX; };
  const onPointerUp = (e) => {
    if (pointerStart.current == null) return;
    const diff = e.clientX - pointerStart.current;
    if (Math.abs(diff) > 40) { diff > 0 ? prev() : next(); }
    pointerStart.current = null;
  };

  const item = mediaItems[idx];

  return (
    <div
      style={{ marginBottom: 12, position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--dl-well)', cursor: 'grab', userSelect: 'none' }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
    >
      {item?.type === 'map' ? (
        <div style={{ width: '100%', aspectRatio: '4/3', background: '#0d1a24', position: 'relative', overflow: 'hidden' }}>
          <MiniLocationMap places={item.places} />
        </div>
      ) : item?.type === 'drawing' ? (
        <div style={{
          width: '100%', aspectRatio: '4/3',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          ...paperStyle(dark),
        }}>
          <img
            src={item.thumbnail}
            alt={item.title}
            style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
          />
        </div>
      ) : (
        <img src={item?.url} alt="" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'contain', display: 'block' }} />
      )}

      {/* Left chevron */}
      {mediaItems.length > 1 && (
        <div onClick={prev} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        >
          <span style={{ fontSize: 22, fontFamily: mono, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>‹</span>
        </div>
      )}

      {/* Right chevron */}
      {mediaItems.length > 1 && (
        <div onClick={next} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'rgba(255,255,255,0.5)', transition: 'color 0.15s' }}
          onMouseEnter={e => e.currentTarget.style.color = '#fff'}
          onMouseLeave={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
        >
          <span style={{ fontSize: 22, fontFamily: mono, textShadow: '0 1px 6px rgba(0,0,0,0.5)' }}>›</span>
        </div>
      )}

      {/* Close X */}
      <button onClick={e => { e.stopPropagation(); onClose(); }} style={{ position: 'absolute', top: 8, right: 8, zIndex: 2, background: 'rgba(0,0,0,0.4)', border: 'none', borderRadius: 100, width: 28, height: 28, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.6)', transition: 'color 0.15s, background 0.15s' }}
        onMouseEnter={e => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.background = 'rgba(0,0,0,0.6)'; }}
        onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.6)'; e.currentTarget.style.background = 'rgba(0,0,0,0.4)'; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>

      {/* Map places badge */}
      {item?.type === 'map' && (
        <div style={{
          position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(13,26,36,0.75)', borderRadius: 6, padding: '3px 10px',
          fontFamily: mono, fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: 'rgba(80,200,220,0.8)', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          {item.places.map(p => p.name).join(' · ')}
        </div>
      )}

      {/* Drawing title badge */}
      {item?.type === 'drawing' && (
        <div style={{
          position: 'absolute', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          background: dark ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.65)',
          borderRadius: 6, padding: '3px 10px',
          fontFamily: mono, fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase',
          color: dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.55)',
          pointerEvents: 'none',
        }}>{item.title}</div>
      )}

      {/* Dots */}
      {mediaItems.length > 1 && (
        <div style={{ position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 6 }}>
          {mediaItems.map((_, i) => (
            <div key={i} onClick={() => setIdx(i)} style={{ width: 6, height: 6, borderRadius: '50%', cursor: 'pointer', background: i === idx ? '#fff' : 'rgba(255,255,255,0.35)', transition: 'background 0.2s' }} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Drop Zone ─────────────────────────────────────────────────────────────────
export function DropZone({ uploading }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: 80, padding: '24px 0', opacity: 0.5,
    }}>
      <span style={{
        fontFamily: mono, fontSize: F.sm, letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: uploading ? 'var(--dl-accent)' : 'var(--dl-middle)',
      }}>
        {uploading ? 'uploading…' : 'drop photos'}
      </span>
    </div>
  );
}

// ── JournalEditor ─────────────────────────────────────────────────────────────
// When `project` is provided, renders a filtered read-only view of <p> blocks
// tagged to that project for the selected date. When null, full editable journal.
// ─── Recent Entries View ─────────────────────────────────────────────────────
// Read-only scrollable list of the N most recent journal dates.

function RecentEntries({ token, userId, date, project }) {
  const todayStr = date || todayKey();
  const [entries, setEntries] = useState(null);

  useEffect(() => {
    if (!token) return;
    const beforeParam = todayStr ? `&before=${todayStr}` : '';
    api.get(`/api/journal?recent=5${beforeParam}`, token).then(d => {
      setEntries(d?.entries ?? []);
    }).catch(() => setEntries([]));
  }, [token, todayStr]);

  const formatLabel = (dateStr) => {
    const [y, m, d] = dateStr.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}, ${y}`;
  };

  const pastEntries = (entries || []).filter(e => {
    if (e.date === todayStr) return false;
    if (!project) return true;
    // Filter: at least one block must have this project in its tags
    return e.blocks?.some(b => (b.project_tags || []).some(t => t.toLowerCase() === project.toLowerCase()));
  });

  const isToday = todayStr === todayKey();

  return (
    <div style={{display:'flex',flexDirection:'column',gap:8,overflowY:'auto'}}>
      {/* Selected day — editable, highlighted */}
      <div>
        <div style={{
          fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
          textTransform:'uppercase',
          color: isToday ? 'var(--dl-accent)' : 'var(--dl-highlight)',
          marginBottom:4,
        }}>
          {isToday ? 'today' : formatLabel(todayStr)}
        </div>
        <JournalEditor key={todayStr} date={todayStr} userId={userId} token={token} />
      </div>

      {/* Loading shimmer for past entries */}
      {entries === null && (
        <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
          <Shimmer width="80%" height={14}/>
          <Shimmer width="60%" height={14}/>
        </div>
      )}

      {/* Past entries — editable */}
      {pastEntries.map(entry => (
        <div key={entry.date}>
          <div style={{
            fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
            textTransform:'uppercase', color:'var(--dl-middle)',
            marginBottom:4, opacity:0.5,
          }}>
            {formatLabel(entry.date)}
          </div>
          <JournalEditor key={entry.date} date={entry.date} userId={userId} token={token} />
        </div>
      ))}
    </div>
  );
}

// ─── Memories View ───────────────────────────────────────────────────────────
// Shows today's entry + 4 past entries spread across the user's full history.
// Uses the recent entries API to find dates with content, then picks 4 evenly
// spaced across the range.

function MemoriesView({ token, userId, date }) {
  const [memories, setMemories] = useState(null);

  useEffect(() => {
    if (!token || !date) return;
    let cancelled = false;

    const findMemories = async () => {
      // Fetch up to 20 recent dates with entries (enough to span history)
      const d = await api.get(`/api/journal?recent=20&before=${date}`, token);
      if (cancelled) return;
      const entries = (d?.entries ?? []).filter(e => e.date !== date);
      if (!entries.length) { setMemories([]); return; }

      // Pick 4 evenly spaced entries from the list
      const count = 4;
      const picked = [];
      if (entries.length <= count) {
        picked.push(...entries);
      } else {
        for (let i = 0; i < count; i++) {
          const idx = Math.round(i * (entries.length - 1) / (count - 1));
          picked.push(entries[idx]);
        }
      }

      if (!cancelled) setMemories(picked.map(e => ({ date: e.date })));
    };

    findMemories().catch(() => { if (!cancelled) setMemories([]); });
    return () => { cancelled = true; };
  }, [token, date]);

  const formatDate = (d) => {
    const [y, m, day] = d.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${day}, ${y}`;
  };

  const relativeLabel = (entryDate) => {
    const now = new Date(date + 'T12:00:00');
    const then = new Date(entryDate + 'T12:00:00');
    const days = Math.round((now - then) / 86400000);
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 14) return '1 week ago';
    if (days < 30) return `${Math.round(days / 7)} weeks ago`;
    if (days < 60) return '1 month ago';
    if (days < 365) return `${Math.round(days / 30)} months ago`;
    const yrs = Math.round(days / 365);
    return yrs === 1 ? '1 year ago' : `${yrs} years ago`;
  };

  const isToday = date === todayKey();

  return (
    <div style={{display:'flex',flexDirection:'column',gap:10,overflowY:'auto'}}>
      {/* Today — editable */}
      <div>
        <div style={{
          fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
          textTransform:'uppercase',
          color: isToday ? 'var(--dl-accent)' : 'var(--dl-highlight)',
          marginBottom:4,
        }}>
          {isToday ? 'today' : formatDate(date)}
        </div>
        <JournalEditor key={date} date={date} userId={userId} token={token} />
      </div>

      {/* Memory slots */}
      {memories === null ? (
        <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
          <Shimmer width="60%" height={14}/>
          <Shimmer width="80%" height={14}/>
        </div>
      ) : memories.length === 0 ? (
        <div style={{fontFamily:mono,fontSize:F.sm,color:'var(--dl-middle)',padding:'8px 0',opacity:0.4}}>
          No memories yet — keep writing!
        </div>
      ) : (
        memories.map(mem => (
          <div key={mem.date}>
            <div style={{
              fontFamily:mono, fontSize:F.sm, letterSpacing:'0.06em',
              textTransform:'uppercase', color:'var(--dl-middle)',
              marginBottom:4, opacity:0.5,
            }}>
              {relativeLabel(mem.date)} — {formatDate(mem.date)}
            </div>
            <JournalEditor key={mem.date} date={mem.date} userId={userId} token={token} />
          </div>
        ))
      )}
    </div>
  );
}

// ─── Journal Mode Toggle ─────────────────────────────────────────────────────
export function JournalModeToggle({ mode, setMode }) {
  const btns = [
    { key: 'day', title: 'Today', icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    )},
    { key: 'recent', title: 'Recent entries', icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    )},
    { key: 'memories', title: 'Memories', icon: (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/>
      </svg>
    )},
  ];
  return (
    <div style={{ display:'flex', gap:2, background:'var(--dl-border-15, rgba(128,120,100,0.1))', borderRadius:100, padding:2 }}>
      {btns.map(b => {
        const active = mode === b.key;
        return (
          <button key={b.key} onClick={e => { e.stopPropagation(); setMode(b.key); }} title={b.title}
            style={{
              padding: '3px 6px',
              borderRadius: 100, cursor: 'pointer', border: 'none',
              background: active ? 'var(--dl-glass-active, var(--dl-accent-13))' : 'transparent',
              color: active ? 'var(--dl-strong)' : 'var(--dl-middle)',
              display: 'flex', alignItems: 'center',
              transition: 'all 0.15s',
            }}>
            {b.icon}
          </button>
        );
      })}
    </div>
  );
}

export function JournalEditor({date,userId,token,project,journalMode}) {
  // All hooks must be called unconditionally (React rules of hooks).
  // The mode check happens in the render output below.
  const {value, setValue, loaded, markDirty} = useDbSave(date, 'journal', '', token, userId);
  const { theme } = useTheme();
  const dark = theme === 'dark';
  const { notes: ctxNotes, drawings: ctxDrawings } = useContext(NoteContext);
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxPlaces = useContext(PlaceNamesContext);
  const { navigateToProject, navigateToNote, navigateToPlace } = useContext(NavigationContext);

  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  // null = strip mode, 0+ = slideshow at that index.
  // Read persisted mode synchronously so there's no strip→slideshow flash.
  const [lightboxIdx, setLightboxIdx] = useState(() => {
    try { return localStorage.getItem('daylab:photoMode') === 'slideshow' ? 0 : null; }
    catch { return null; }
  });
  const editorRef = useRef(null);
  const dragCounter = useRef(0);

  const images = useMemo(() => extractImages(value), [value]);

  // Build a data map from drawing objects in context: title → { thumbnail }
  const drawingThumbnailMap = useMemo(() => {
    const map = {};
    (ctxDrawings || []).forEach(d => {
      if (d && typeof d === 'object' && d.title && d.thumbnail) {
        map[d.title] = d.thumbnail;
      }
    });
    return map;
  }, [ctxDrawings]);

  // Typed photo media items
  const photoItems = useMemo(() => images.map(url => ({ type: 'photo', url })), [images]);

  // Typed drawing media items referenced by /d tags in the journal content
  const drawingItems = useMemo(() => {
    const titles = extractDrawingTags(value);
    return titles
      .map(t => drawingThumbnailMap[t] ? { type: 'drawing', title: t, thumbnail: drawingThumbnailMap[t] } : null)
      .filter(Boolean);
  }, [value, drawingThumbnailMap]);

  // All places with lat/lng data (fetched once for location map)
  const [allPlaces, setAllPlaces] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.get('/api/places', token).then(d => setAllPlaces(d?.places ?? [])).catch(() => {});
  }, [token]);

  // Place tags referenced in journal content → single map item if any have coordinates
  const mapItem = useMemo(() => {
    const taggedNames = extractPlaceTags(value);
    if (!taggedNames.length || !allPlaces.length) return null;
    const tagged = taggedNames
      .map(name => allPlaces.find(p => p.name === name))
      .filter(p => p && p.lat != null && p.lng != null)
      .map(p => ({ name: p.name, lat: p.lat, lng: p.lng, color: p.color }));
    return tagged.length ? { type: 'map', places: tagged } : null;
  }, [value, allPlaces]);

  // All visual media as typed items: photos, then drawings, then map (if any tagged places)
  const allMedia = useMemo(() => {
    const items = [...photoItems, ...drawingItems];
    if (mapItem) items.push(mapItem);
    return items;
  }, [photoItems, drawingItems, mapItem]);

  // Flat image URL list kept for backward-compat (reorderImages, legacy refs)
  const allImages = useMemo(() => allMedia.map(m => m.type === 'photo' ? m.url : m.thumbnail), [allMedia]);

  // Persist mode preference to user_settings for public share pages only
  useEffect(() => {
    if (journalMode) return; // only run in day mode
    const mode = lightboxIdx != null ? 'slideshow' : 'strip';
    try { localStorage.setItem('daylab:photoMode', mode); } catch {}
    if (token) api.patch('/api/settings', { photoMode: mode }, token).catch(() => {});
  }, [lightboxIdx != null, journalMode]); // eslint-disable-line


  // Close slideshow when navigating to a day with no media
  useEffect(() => {
    if (journalMode) return;
    if (allMedia.length === 0 && lightboxIdx != null) setLightboxIdx(null);
    if (lightboxIdx != null && allMedia.length > 0 && lightboxIdx >= allMedia.length) {
      setLightboxIdx(0);
    }
  }, [allMedia.length, journalMode]); // eslint-disable-line

  // Format date for chip label: "Mar 16"
  const chipDate = useMemo(() => {
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[m - 1]} ${d}`;
  }, [date]);

  // Reorder images in journal content to match new order
  const reorderImages = useCallback((newOrder) => {
    let content = value || '';
    // Remove all image references (chips with nested spans, imageblocks, [img:] tags)
    content = stripImageChips(content);
    content = content.replace(/<div\s+data-imageblock="[^"]*"[^>]*>[\s\S]*?<\/div>/g, '');
    content = content.replace(/\[img:https?:\/\/[^\]]+\]\n?/g, '');
    content = content.replace(/<p>\s*<\/p>/g, '');
    // Re-add in new order
    const chips = newOrder.map(url =>
      `<span data-image-chip="${url}" data-chip-label="${chipDate}">\u{1F4F7}</span> `
    ).join('');
    if (chips) {
      if (content.includes('</p>')) {
        content = content.replace(/<\/p>\s*$/, chips + '</p>');
      } else {
        content = (content || '') + `<p>${chips}</p>`;
      }
    }
    // Update backing store
    setValue(content, { undoLabel: 'Reorder photos' });
    // Sync editor's internal state so it won't overwrite on next blur
    editorRef.current?.setContent?.(content);
  }, [value, setValue, chipDate]);

  // Append image chip to journal content
  const addImage = useCallback((url) => {
    setValue(prev => {
      if (prev && prev.includes(url)) return prev;
      const chipHtml = `<span data-image-chip="${url}" data-chip-label="${chipDate}">\u{1F4F7}</span> `;
      if (prev && prev.includes('</p>')) {
        return prev.replace(/<\/p>\s*$/, chipHtml + '</p>');
      }
      return (prev || '') + `<p>${chipHtml}</p>`;
    }, { undoLabel: 'Add photo' });
  }, [setValue, chipDate]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current = 0;
    setDragging(false);
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type.startsWith('image/'));
    if (!files.length || !token) return;
    setUploading(true);
    try {
      const urls = await Promise.all(files.map(f => uploadImageFile(f, token)));
      urls.filter(Boolean).forEach(url => addImage(url));
    } finally {
      setUploading(false);
    }
  }, [token, addImage]);

  // Click delegation: image chip → open slideshow at that media item
  const handleChipClick = useCallback((e) => {
    // Photo chip click
    const photoChip = e.target.closest?.('[data-image-chip]');
    if (photoChip) {
      const url = photoChip.dataset.imageChip;
      if (!url) return;
      const idx = allMedia.findIndex(m => m.type === 'photo' && m.url === url);
      if (idx !== -1) setLightboxIdx(idx);
      return;
    }
    // Drawing chip click
    const drawingChip = e.target.closest?.('[data-drawing-tag]');
    if (drawingChip) {
      const dTitle = drawingChip.dataset.drawingTag;
      if (!dTitle) return;
      const idx = allMedia.findIndex(m => m.type === 'drawing' && m.title === dTitle);
      if (idx !== -1) setLightboxIdx(idx);
    }
  }, [allMedia]);

  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer?.types?.includes('Files')) setDragging(true);
  }, []);
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); }
  }, []);
  const handleDragOver = useCallback((e) => { e.preventDefault(); }, []);

  // ── Mode-based rendering ──────────────────────────────────────────────────
  if (journalMode === 'recent') return <RecentEntries token={token} userId={userId} date={date} project={project} />;
  if (journalMode === 'memories') return <MemoriesView token={token} userId={userId} date={date} />;

  if (!loaded) return (
    <div style={{display:'flex',flexDirection:'column',gap:10,padding:'4px 0'}}>
      <Shimmer width="80%" height={14}/>
      <Shimmer width="60%" height={14}/>
      <Shimmer width="70%" height={14}/>
    </div>
  );

  // Project-filtered view: show only <p> blocks tagged to the project for the selected date
  if (project && project !== '__everything__') {
    const paraRe = /<p\b[^>]*>[\s\S]*?<\/p>/gi;
    const blocks = (value || '').match(paraRe) || [];
    const tagPattern = `data-project-tag="${project}"`;
    const matched = blocks.filter(b => b.includes(tagPattern));
    if (matched.length === 0) return null;
    return (
      <div style={{display:'flex',flexDirection:'column',gap:4}}>
        {matched.map((block, i) => (
          <div key={i}
            style={{fontFamily:serif,fontSize:F.md,lineHeight:1.7,color:'var(--dl-strong)',wordBreak:'break-word'}}
            dangerouslySetInnerHTML={{__html: block}}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      onClickCapture={handleChipClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {lightboxIdx != null && allMedia.length > 0 ? (
        <MediaSlideshow mediaItems={allMedia} index={lightboxIdx} onClose={() => setLightboxIdx(null)} dark={dark} />
      ) : allMedia.length > 0 ? (
        <MediaStrip mediaItems={allMedia} onViewItem={i => setLightboxIdx(i)} onReorderPhotos={images.length > 1 ? reorderImages : undefined} dark={dark} />
      ) : null}
      {(dragging || uploading) ? (
        <DropZone uploading={uploading} />
      ) : (
        <DayLabEditor
          ref={editorRef}
          key={date}
          value={value || ''}
          onBlur={html => setValue(html, {undoLabel: 'Edit notes'})}
          onUpdate={html => markDirty(html)}
          onImageUpload={file => uploadImageFile(file, token)}
          onImageDelete={src => deleteImageFile(src, token)}
          noteNames={ctxNotes}
          drawingNames={ctxDrawings}
          projectNames={ctxProjects}
          placeNames={ctxPlaces}
          showScheduleTags={false}
          onProjectClick={name => navigateToProject(name)}
          onNoteClick={name => navigateToNote(name)}
          onPlaceClick={name => navigateToPlace(name)}
          placeholder="What's on your mind? Use / for tags."
          textColor={"var(--dl-strong)"}
          mutedColor={"var(--dl-middle)"}
          color={"var(--dl-accent)"}
          hideInlineImages
          style={{minHeight: 80, width: '100%'}}
        />
      )}
    </div>
  );
}

// ─── RowList ─────────────────────────────────────────────────────────────────
// Single multi-line editor where each paragraph = one item.
// syncedRows: live from API, rendered read-only above the editor.
// AI estimates for synced rows persist to DB under type+"_kcal" key.

function htmlToLines(html) {
  if (!html || typeof html !== 'string') return [];
  return html.split(/<\/p>\s*<p[^>]*>|<br\s*\/?>/)
    .map(s => s.replace(/<[^>]*>/g, '').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim())
    .filter(Boolean);
}

function linesToHtml(lines) {
  return lines.map(l => `<p>${l.replace(/&/g,'&amp;').replace(/</g,'&lt;')}</p>`).join('');
}

function rowsToHtml(rows) {
  const lines = (rows || []).filter(r => r.text?.trim()).map(r => r.text);
  return lines.length ? linesToHtml(lines) : '';
}

export function RowList({date,type,placeholder,promptFn,prefix,color,token,userId,syncedRows=[],showProtein=false}) {
  const {value:rows, setValue:setRows, loaded} = useDbSave(date, type, [], token, userId);
  const {value:savedEstimates, setValue:setSavedEstimates, loaded:estimatesLoaded} = useDbSave(date, type+"_kcal", {}, token, userId);
  const estimating = useRef(new Set());
  const failed = useRef(new Set());
  // Track which texts have already been sent for estimation so we never
  // re-request for the same unchanged text, even across re-renders.
  const estimated = useRef(new Set());

  const safe = Array.isArray(rows) ? rows : [];
  const estMap = (estimatesLoaded && savedEstimates && typeof savedEstimates === "object") ? savedEstimates : {};

  // Build a lookup from text → row data for preserving kcal/protein across edits
  const rowByText = useRef(new Map());
  useEffect(() => {
    const m = new Map();
    for (const r of safe) { if (r.text?.trim()) m.set(r.text.trim(), r); }
    rowByText.current = m;
  }, [safe]);

  // Merge saved AI estimates into synced rows
  const merged = syncedRows.map(r => {
    const saved = estMap[r.id];
    const kcal = r.kcal || (typeof saved === "object" ? saved?.kcal : saved) || null;
    const protein = r.protein || (typeof saved === "object" ? saved?.protein : null) || null;
    return {...r, kcal, protein};
  });
  const totalKcal = [...safe, ...merged].reduce((s,r) => s + (r.kcal||0), 0);
  const totalProtein = showProtein ? [...safe, ...merged].reduce((s,r) => s + (r.protein||0), 0) : 0;

  // ── Run estimation as a direct call, not via effects ──
  // This avoids cascading re-renders from effect dep changes.
  const runEstimates = useCallback(() => {
    if (!token || !loaded) return;

    // 1. Manual rows missing kcal
    safe
      .filter(r => r.text?.trim() && !r.kcal && !estimating.current.has(r.text)
        && !failed.current.has(r.text) && !estimated.current.has(r.text))
      .forEach(row => {
        estimating.current.add(row.text);
        estimated.current.add(row.text);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.text);
          if (result) setRows(prev => (Array.isArray(prev)?prev:[]).map(r =>
            r.text===row.text ? {...r, kcal:result.kcal||null, protein:result.protein||null} : r));
          else failed.current.add(row.text);
        });
      });

    // 2. Manual rows with kcal but missing protein
    if (showProtein) {
      safe
        .filter(r => r.text?.trim() && r.kcal && !r.protein
          && !estimating.current.has(r.text+"_p") && !failed.current.has(r.text+"_p")
          && !estimated.current.has(r.text+"_p"))
        .forEach(row => {
          estimating.current.add(row.text+"_p");
          estimated.current.add(row.text+"_p");
          estimateNutrition(promptFn(row.text), token).then(result => {
            estimating.current.delete(row.text+"_p");
            if (result?.protein) {
              setRows(prev => (Array.isArray(prev)?prev:[]).map(r =>
                r.text===row.text ? {...r, protein:result.protein, kcal:result.kcal||r.kcal} : r));
            } else failed.current.add(row.text+"_p");
          });
        });
    }
  }, [token, loaded, showProtein, promptFn]); // eslint-disable-line

  // Estimate synced rows (from API) — runs once when syncedRows arrive
  const syncedEstimatedRef = useRef(new Set());
  useEffect(() => {
    if (!token || !loaded || !estimatesLoaded) return;
    merged
      .filter(r => !r.kcal && r.text && !estimating.current.has(r.id)
        && !failed.current.has(r.id) && !syncedEstimatedRef.current.has(r.id))
      .forEach(row => {
        estimating.current.add(row.id);
        syncedEstimatedRef.current.add(row.id);
        estimateNutrition(promptFn(row.text), token).then(result => {
          estimating.current.delete(row.id);
          if (result) setSavedEstimates(prev => ({...(typeof prev==="object"&&prev?prev:{}), [row.id]:result}));
          else failed.current.add(row.id);
        });
      });
  }, [syncedRows, loaded, estimatesLoaded, token]); // eslint-disable-line

  // Run estimates once on initial load
  useEffect(() => {
    if (loaded && token) runEstimates();
  }, [loaded, token]); // eslint-disable-line

  // Convert editor HTML → rows array, preserving kcal for unchanged lines
  function parseEditorHtml(html) {
    const lines = htmlToLines(html);
    const usedTexts = new Set();
    return lines.map(text => {
      const existing = rowByText.current.get(text);
      if (existing && !usedTexts.has(text)) {
        usedTexts.add(text);
        return existing;
      }
      return { id: Date.now() + Math.random(), text, kcal: null, protein: null };
    });
  }
  // State is only committed on blur or Enter, not mid-keystroke.
  // This prevents the value→re-render→setContent loop that kicks mobile users
  // out of the editor while they're still typing.
  // Estimation runs once after rows are committed — not on every re-render.
  function handleBlur(html) {
    setRows(parseEditorHtml(html));
    // Run estimates after a microtask so setRows has flushed
    Promise.resolve().then(runEstimates);
  }
  function handleKeyDown(e) {
    if (e.key === 'Enter') Promise.resolve().then(runEstimates);
  }

  if (!loaded) return (
    <div style={{display:"flex",flexDirection:"column",gap:8,padding:"4px 0"}}>
      <Shimmer width="75%" height={13}/>
      <Shimmer width="55%" height={13}/>
      <Shimmer width="65%" height={13}/>
    </div>
  );

  // Per-line stats for the stats column
  const manualLines = safe.filter(r => r.text?.trim());
  const chipBase = {fontFamily:mono, fontSize:F.sm, letterSpacing:"0.04em", flexShrink:0,
    borderRadius:4, padding:"2px 8px", whiteSpace:"nowrap"};
  const PROT_W = 50, ENRG_W = 72;
  const statStyle = {display:"flex",alignItems:"center",justifyContent:"center",height:28};
  const colProtein = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-blue)", width:PROT_W, textAlign:"center", whiteSpace:"nowrap"};
  const colKcal = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-orange)", width:ENRG_W, textAlign:"center", whiteSpace:"nowrap"};
  const colMuted = {fontFamily:mono, fontSize:F.sm, color:"var(--dl-highlight)", textAlign:"center", whiteSpace:"nowrap"};
  const rowStyle = {display:"flex", alignItems:"center", gap:0, padding:"3px 0", minHeight:28};

  return (
    <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
      <div style={{flex:1,overflowY:"auto",minHeight:0}}>
        {/* Synced rows (read-only) */}
        {merged.map(row => (
          <div key={row.id} style={rowStyle}>
            <span style={{lineHeight:1.7,flex:1,minWidth:0}}>
              <RichLine text={row.text}/>
            </span>
            <SourceBadge source={row.source}/>
            {showProtein && (
              <span style={row.protein ? colProtein : {...colMuted,width:PROT_W}}>
                {estimating.current.has(row.id) ? "…" : row.protein ? `${row.protein}g` : "—"}
              </span>
            )}
            <span style={row.kcal ? colKcal : {...colMuted,width:ENRG_W}}>
              {estimating.current.has(row.id) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
            </span>
          </div>
        ))}
        {/* Manual entries — single multi-line editor + stats column */}
        <div style={{display:"flex",gap:0}} onKeyDown={handleKeyDown}>
          <DayLabEditor
            value={rowsToHtml(safe)}
            onBlur={handleBlur}
            placeholder={merged.length === 0 ? placeholder : ""}
            textColor={"var(--dl-strong)"}
            mutedColor={"var(--dl-middle)"}
            color={"var(--dl-accent)"}
            style={{flex:1,padding:0,minHeight:28}}
          />
          {manualLines.length > 0 && (
            <div style={{flexShrink:0,display:"flex",flexDirection:"column"}}>
              {manualLines.map((row,i) => (
                <div key={i} style={{...statStyle,gap:0}}>
                  {showProtein && (
                    <span style={row.protein ? colProtein : {...colMuted,width:PROT_W}}>
                      {estimating.current.has(row.text) ? "…" : row.protein ? `${row.protein}g` : "—"}
                    </span>
                  )}
                  <span style={row.kcal ? colKcal : {...colMuted,width:ENRG_W}}>
                    {estimating.current.has(row.text) ? "…" : row.kcal ? `${row.kcal}kcal` : "—"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {(totalKcal > 0 || totalProtein > 0) && (
        <div style={{flexShrink:0,paddingTop:6,display:"flex",alignItems:"center",gap:0,borderTop:"1px solid var(--dl-border)"}}>
          <div style={{flex:1}}/>
          {showProtein && (
            <div style={{width:PROT_W,display:"flex",justifyContent:"center"}}>
              {totalProtein > 0 && <span style={{...chipBase,background:"var(--dl-blue-13)",color:"var(--dl-blue)"}}>{totalProtein}g</span>}
            </div>
          )}
          <div style={{width:ENRG_W,display:"flex",justifyContent:"center"}}>
            {totalKcal > 0 && <span style={{...chipBase,background:"var(--dl-orange-13)",color:"var(--dl-orange)"}}>{totalKcal}kcal</span>}
          </div>
        </div>
      )}
    </div>
  );
}


export function Meals({date,token,userId}) { return <RowList date={date} type="meals" token={token} userId={userId} placeholder="What did you eat?" promptFn={t=>`Estimate calories and protein for this meal: "${t}". Assume a typical single-serving portion unless a quantity is specified. Be accurate — don't round to convenient numbers. Examples: "avocado toast" → {"kcal":280,"protein":8}, "chicken breast with rice" → {"kcal":480,"protein":42}, "greek yogurt with berries" → {"kcal":180,"protein":15}. Return ONLY JSON: {"kcal":number,"protein":number}`} prefix="" color={"var(--dl-accent)"} showProtein/>; }

export function AddJournalLine({ project, onAdd, placeholder }) {
  const col = project && project !== '__everything__' ? projectColor(project) : "var(--dl-accent)";
  const ctxProjects = useContext(ProjectNamesContext);
  const ctxPlaces   = useContext(PlaceNamesContext);
  const ctxNotes    = useContext(NoteContext);
  const { navigateToProject, navigateToNote, navigateToPlace } = useContext(NavigationContext);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '2px 0' }}>
      <DayLabEditor
        singleLine
        placeholder={placeholder || 'Add an entry…'}
        projectNames={ctxProjects}
        placeNames={ctxPlaces}
        noteNames={ctxNotes.notes}
        drawingNames={ctxNotes.drawings}
        showScheduleTags={false}
        textColor={"var(--dl-strong)"}
        mutedColor={"var(--dl-middle)"}
        color={col}
        style={{ flex: 1, padding: 0 }}
        onProjectClick={name => navigateToProject(name)}
        onNoteClick={name => navigateToNote(name)}
        onPlaceClick={name => navigateToPlace(name)}
        onEnterCommit={text => { if (text.trim()) onAdd(text.trim()); }}
        onBlur={text => { if (text.trim()) onAdd(text.trim()); }}
      />
    </div>
  );
}
