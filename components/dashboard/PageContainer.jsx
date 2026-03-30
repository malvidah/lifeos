"use client";
import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * PageContainer — horizontally paginated container using CSS transforms.
 *
 * Layout:
 *   outer (overflow:hidden, flex:1)   ← must NEVER scroll
 *     track (flex, width = n*100%, translateX drives paging)
 *       page (width = 100%/n, overflow-y:auto)
 *
 * Swipe navigation:
 *   Touch: imperative listeners with { passive: false } so we can claim
 *     horizontal gestures via preventDefault() before the browser does.
 *   Mouse: pointer events with setPointerCapture for reliable drag detection.
 *
 * Animation is a CSS transition on the track's transform.
 * On first mount the transition is suppressed so there's no slide-in effect.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const outerRef   = useRef(null);
  const trackRef   = useRef(null);
  const [animated, setAnimated] = useState(false);

  // Lock the outer container's scroll position to (0,0) at all times.
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

  // Enable animation after first paint so there's no slide-in on load.
  useEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimated(true));
    });
  }, []);

  const n   = pages.length || 1;
  const pct = currentPageIdx * (100 / n);

  // ── Stable callback ref for onPageChange ─────────────────────────────────
  // So the imperative touch effect doesn't re-attach listeners on every render.
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const currentIdxRef = useRef(currentPageIdx);
  currentIdxRef.current = currentPageIdx;
  const pageCountRef = useRef(n);
  pageCountRef.current = n;

  // ── Touch swipe (mobile) ─────────────────────────────────────────────────
  // Imperative with { passive: false } so preventDefault() works.
  const touchRef = useRef(null);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY, claimed: false };
    };

    const onTouchMove = (e) => {
      if (!touchRef.current) return;
      const t = e.touches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;

      if (touchRef.current.claimed) {
        e.preventDefault();
        return;
      }
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        touchRef.current = null;
        return;
      }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        e.preventDefault();
        touchRef.current.claimed = true;
      }
    };

    const onTouchEnd = (e) => {
      if (!touchRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;
      const wasClaimed = touchRef.current.claimed;
      touchRef.current = null;
      if (!wasClaimed) return;
      if (Math.abs(dx) < 40) return;
      if (Math.abs(dy) > Math.abs(dx) * 0.75) return;
      const idx = currentIdxRef.current;
      const total = pageCountRef.current;
      const newIdx = dx < 0
        ? Math.min(idx + 1, total - 1)
        : Math.max(idx - 1, 0);
      if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
    };

    outer.addEventListener('touchstart', onTouchStart, { passive: true });
    outer.addEventListener('touchmove',  onTouchMove,  { passive: false });
    outer.addEventListener('touchend',   onTouchEnd,   { passive: true });

    return () => {
      outer.removeEventListener('touchstart', onTouchStart);
      outer.removeEventListener('touchmove',  onTouchMove);
      outer.removeEventListener('touchend',   onTouchEnd);
    };
  }, []); // stable — uses refs for changing values

  // ── Pointer swipe (desktop mouse) ────────────────────────────────────────
  // setPointerCapture ensures pointerup fires even if cursor leaves the div.
  // Only handles mouse — touch is handled above via touch events.
  const pointerRef = useRef(null);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType !== 'mouse') return; // touch handled by touch events
    if (e.button !== 0) return;
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
    const idx = currentIdxRef.current;
    const total = pageCountRef.current;
    const newIdx = dx < 0
      ? Math.min(idx + 1, total - 1)
      : Math.max(idx - 1, 0);
    if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
  }, []);

  const handlePointerCancel = useCallback(() => {
    pointerRef.current = null;
  }, []);

  return (
    <div
      ref={outerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        touchAction: 'pan-y',
      }}
    >
      <div
        ref={trackRef}
        style={{
          display: 'flex',
          width: `${n * 100}%`,
          height: '100%',
          transition: animated ? 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
          transform: `translateX(-${pct}%)`,
          willChange: 'transform',
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
            }}
          >
            {renderPage(page, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
