"use client";
import { useLayoutEffect, useRef, useCallback, useEffect } from 'react';

/**
 * PageContainer — horizontally paginated container using CSS transforms.
 *
 * Layout:
 *   outer (overflow:hidden, flex:1, touch-action:pan-y)
 *     track (flex, width=n*100%, translateX drives paging)
 *       page (width=100%/n, overflow-y:auto, touch-action:pan-y)
 *
 * WHY overflow:hidden (not clip):
 * overflow:hidden makes the outer a scroll container. scrollIntoView() from
 * cards will try to scroll the outer instead of the page divs. The scroll
 * lock below immediately resets the outer to (0,0), so no card can disturb
 * the paging position. With overflow:clip the outer is NOT a scroll container,
 * so scrollIntoView() falls through to the page divs, which have no lock —
 * content gets permanently clipped on mobile.
 *
 * TRANSITION:
 * Managed entirely imperatively so React never fights us during drag.
 * React owns `transform` (which page), we own `transition` (animation).
 *
 * SWIPE:
 * Touch: real-time drag in touchmove, snap/navigate at touchend.
 * Mouse: pointerdown/up with setPointerCapture.
 * Trackpad: wheel events with debounced idle timer (one nav per gesture).
 * All three guard against horizontal-scrollable cards and text selection.
 */

function isInsideHorizontalScroll(el, boundary) {
  while (el && el !== boundary) {
    const ox = window.getComputedStyle(el).overflowX;
    if ((ox === 'scroll' || ox === 'auto') && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

function hasTextSelection() {
  return !!window.getSelection?.()?.toString();
}

const TRANSITION = 'transform 0.28s cubic-bezier(0.33, 1, 0.68, 1)';

export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const outerRef = useRef(null);
  const trackRef = useRef(null);

  const n   = pages.length || 1;
  const pct = currentPageIdx * (100 / n);

  const onPageChangeRef  = useRef(onPageChange);  onPageChangeRef.current  = onPageChange;
  const currentIdxRef    = useRef(currentPageIdx); currentIdxRef.current    = currentPageIdx;
  const pageCountRef     = useRef(n);              pageCountRef.current     = n;

  // ── Transition (imperative — React never touches this property) ───────────
  // Suppress on first mount so there's no slide-in. Re-enable after 2 rAFs.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = TRANSITION;
      });
    });
  }, []);

  // ── Scroll lock ───────────────────────────────────────────────────────────
  // overflow:hidden makes the outer a scroll container. Any scrollIntoView()
  // call from a card will try to scroll the outer; we immediately reset it.
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;
    const lock = () => {
      if (outer.scrollLeft !== 0) outer.scrollLeft = 0;
      if (outer.scrollTop  !== 0) outer.scrollTop  = 0;
    };
    outer.addEventListener('scroll', lock, { passive: true });
    return () => outer.removeEventListener('scroll', lock);
  }, []);

  // ── Touch swipe (mobile) — real-time drag + snap/navigate at touchend ────
  const touchRef = useRef(null);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (isInsideHorizontalScroll(e.target, outer)) return;
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY, dx: 0, horizontal: false };
    };

    const onTouchMove = (e) => {
      if (!touchRef.current) return;
      const t  = e.touches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;

      if (!touchRef.current.horizontal) {
        // Cancel if gesture is clearly vertical
        if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 8) {
          touchRef.current = null;
          return;
        }
        if (Math.abs(dx) > 8) touchRef.current.horizontal = true;
      }

      if (touchRef.current.horizontal) {
        touchRef.current.dx = dx;
        const p = currentIdxRef.current * (100 / pageCountRef.current);
        if (trackRef.current) {
          trackRef.current.style.transition = 'none';
          trackRef.current.style.transform  = `translateX(calc(-${p}% + ${dx}px))`;
        }
      }
    };

    const snapTo = (newIdx) => {
      const newPct = newIdx * (100 / pageCountRef.current);
      if (trackRef.current) {
        trackRef.current.style.transition = TRANSITION;
        trackRef.current.style.transform  = `translateX(-${newPct}%)`;
      }
      if (newIdx !== currentIdxRef.current) onPageChangeRef.current?.(newIdx);
    };

    const onTouchEnd = () => {
      if (!touchRef.current) return;
      const { dx } = touchRef.current;
      touchRef.current = null;

      const idx = currentIdxRef.current;
      const n   = pageCountRef.current;

      if (Math.abs(dx) < 40 || hasTextSelection()) { snapTo(idx); return; }

      snapTo(dx < 0 ? Math.min(idx + 1, n - 1) : Math.max(idx - 1, 0));
    };

    const onTouchCancel = () => {
      if (touchRef.current) {
        snapTo(currentIdxRef.current);
        touchRef.current = null;
      }
    };

    outer.addEventListener('touchstart',  onTouchStart,  { passive: true });
    outer.addEventListener('touchmove',   onTouchMove,   { passive: true });
    outer.addEventListener('touchend',    onTouchEnd,    { passive: true });
    outer.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      outer.removeEventListener('touchstart',  onTouchStart);
      outer.removeEventListener('touchmove',   onTouchMove);
      outer.removeEventListener('touchend',    onTouchEnd);
      outer.removeEventListener('touchcancel', onTouchCancel);
    };
  }, []);

  // ── Pointer swipe (desktop mouse) ─────────────────────────────────────────
  const pointerRef = useRef(null);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    if (isInsideHorizontalScroll(e.target, outerRef.current)) return;
    outerRef.current?.setPointerCapture(e.pointerId);
    pointerRef.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handlePointerUp = useCallback((e) => {
    if (!pointerRef.current) return;
    const dx = e.clientX - pointerRef.current.x;
    const dy = e.clientY - pointerRef.current.y;
    pointerRef.current = null;
    if (Math.abs(dx) < 40) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.75) return;
    if (hasTextSelection()) return;
    const idx   = currentIdxRef.current;
    const total = pageCountRef.current;
    const newIdx = dx < 0 ? Math.min(idx + 1, total - 1) : Math.max(idx - 1, 0);
    if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
  }, []);

  const handlePointerCancel = useCallback(() => { pointerRef.current = null; }, []);

  // ── Trackpad two-finger swipe (wheel events) ──────────────────────────────
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    let hasNavigated = false;
    let idleTimer    = null;

    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (Math.abs(e.deltaX) < 10) return;
      if (isInsideHorizontalScroll(e.target, outer)) return;

      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { idleTimer = null; hasNavigated = false; }, 350);

      if (hasNavigated) return;
      hasNavigated = true;

      const idx   = currentIdxRef.current;
      const total = pageCountRef.current;
      const newIdx = e.deltaX > 0 ? Math.min(idx + 1, total - 1) : Math.max(idx - 1, 0);
      if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
    };

    outer.addEventListener('wheel', onWheel, { passive: true });
    return () => { outer.removeEventListener('wheel', onWheel); if (idleTimer) clearTimeout(idleTimer); };
  }, []);

  return (
    <div
      ref={outerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ position: 'relative', overflow: 'hidden', flex: 1, touchAction: 'pan-y' }}
    >
      <div
        ref={trackRef}
        style={{
          display: 'flex',
          width: `${n * 100}%`,
          height: '100%',
          transform: `translateX(-${pct}%)`,
          willChange: 'transform',
          // transition is managed imperatively — not here
        }}
      >
        {pages.map((page, i) => (
          <div
            key={page.name || i}
            style={{
              width: `${100 / n}%`,
              minWidth: `${100 / n}%`,
              overflowY: 'auto',
              overflowX: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              touchAction: 'pan-y',
            }}
          >
            {renderPage(page, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
