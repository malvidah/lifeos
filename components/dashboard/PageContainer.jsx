"use client";
import { useEffect, useRef } from 'react';

/**
 * PageContainer — horizontally paginated container using CSS transforms.
 *
 * WHY TRANSFORMS, NOT SCROLLLEFT:
 * Browsers save and restore the scrollLeft of overflow containers across page
 * refreshes (independent of window.history.scrollRestoration). There is no
 * reliable cross-browser way to prevent this for a custom overflow div.
 * CSS transforms are never saved or restored by the browser, so the correct
 * page is always shown immediately — no effects, no rAF, no guards needed.
 *
 * Layout:
 *   outer (overflow:hidden, flex:1)   ← must NEVER scroll
 *     track (flex, width = n*100%, translateX drives paging)
 *       page (width = 100%/n, overflow-y:auto)
 *
 * WHY WE LOCK THE OUTER'S SCROLL POSITION:
 * Even with overflow:hidden, the browser CAN still scroll the element
 * programmatically — most commonly via scrollIntoView() triggered by a card
 * initialising (e.g. the Map card auto-focusing its canvas). That scroll
 * stacks on top of the CSS transform and lands you between pages.
 * We prevent this by listening for any scroll on the outer wrapper and
 * immediately resetting both axes to 0.
 *
 * SWIPE NAVIGATION:
 * Horizontal swipe gestures on the outer div navigate pages. Requires ≥40px
 * of horizontal movement that is more horizontal than vertical (dy < dx*0.75).
 * touchAction:'pan-y' lets the browser handle vertical scrolling inside cards
 * while we receive the horizontal pointer events for page navigation.
 *
 * Animation is a CSS transition on the track's transform.
 * On first mount the transition is suppressed so there's no sliding-in effect.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const outerRef   = useRef(null);
  const trackRef   = useRef(null);
  const hasMounted = useRef(false);
  const swipeRef   = useRef(null); // { x, y } on pointerdown

  // Lock the outer container's scroll position to (0,0) at all times.
  // The outer should NEVER scroll — paging is done entirely via transform.
  // Cards that call scrollIntoView (e.g. Map) would otherwise push the
  // container's scrollLeft and make pages appear offset.
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

  // Suppress the CSS transition for the very first render so there's no
  // slide-in animation on page load. Re-enable it after two rAFs (one frame).
  useEffect(() => {
    const track = trackRef.current;
    if (!track || hasMounted.current) return;
    track.style.transition = 'none';
    hasMounted.current = true;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (trackRef.current) {
          trackRef.current.style.transition =
            'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';
        }
      });
    });
  }, []);

  const n   = pages.length || 1;
  const pct = currentPageIdx * (100 / n);  // translateX offset in %

  // ── Swipe-to-navigate handlers ───────────────────────────────────────────
  // Primary navigation method: swipe anywhere on the page content area.
  // Requires ≥40px horizontal movement, more horizontal than vertical.
  // Works for both touch and mouse; touchAction:'pan-y' on the outer div
  // lets the browser handle vertical card scrolling while we get horizontal.
  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e) => {
    if (!swipeRef.current) return;
    const dx = e.clientX - swipeRef.current.x;
    const dy = e.clientY - swipeRef.current.y;
    swipeRef.current = null;
    if (Math.abs(dx) < 40) return;                       // too short
    if (Math.abs(dy) > Math.abs(dx) * 0.75) return;     // too vertical
    const newIdx = dx < 0
      ? Math.min(currentPageIdx + 1, n - 1)
      : Math.max(currentPageIdx - 1, 0);
    if (newIdx !== currentPageIdx) onPageChange?.(newIdx);
  };

  const handlePointerCancel = () => { swipeRef.current = null; };

  // ── Touch-based swipe (more reliable on mobile) ──────────────────────────
  // Pointer events can get cancelled by the browser's scroll handling on
  // mobile. Touch events always fire, so we use them as the primary swipe
  // detection for touch devices.
  const touchRef = useRef(null);

  const handleTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY, settled: false };
  };

  const handleTouchMove = (e) => {
    if (!touchRef.current || touchRef.current.settled) return;
    const t = e.touches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    // Once we know it's a horizontal swipe, prevent vertical scroll
    if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
      e.preventDefault();
      touchRef.current.settled = true;
    } else if (Math.abs(dy) > 10) {
      // Vertical — let browser handle, stop tracking
      touchRef.current = null;
    }
  };

  const handleTouchEnd = (e) => {
    if (!touchRef.current) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchRef.current.x;
    const dy = t.clientY - touchRef.current.y;
    touchRef.current = null;
    if (Math.abs(dx) < 40) return;
    if (Math.abs(dy) > Math.abs(dx) * 0.75) return;
    const newIdx = dx < 0
      ? Math.min(currentPageIdx + 1, n - 1)
      : Math.max(currentPageIdx - 1, 0);
    if (newIdx !== currentPageIdx) onPageChange?.(newIdx);
  };

  return (
    <div
      ref={outerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
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
          transition: 'none',               // overridden to smooth after mount
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
