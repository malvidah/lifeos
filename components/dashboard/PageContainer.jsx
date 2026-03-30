"use client";
import { useRef, useEffect } from 'react';

/**
 * PageContainer — horizontally paginated container.
 *
 * Navigation is entirely programmatic (arrow buttons, PageDots clicks, PageDots
 * swipe gesture). Native horizontal touch-scrolling on the main content area is
 * disabled via `touchAction: pan-y` so that:
 *   a) Cards with internal horizontal scroll (e.g. Calendar) work without
 *      accidentally triggering a page change.
 *   b) Page changes on mobile are only possible by swiping the PageDots pill.
 *
 * Programmatic scrollTo is still used for smooth arrow / dot animation.
 *
 * Mount scroll strategy: browser scroll-restoration can override scrollLeft
 * before our effect runs, AND el.offsetWidth is 0 at effect time (element not
 * yet laid out). Fix: disable restoration globally, then spin on rAF until the
 * element has a real width, then hard-set scrollLeft.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const containerRef      = useRef(null);
  const unlockTimer       = useRef(null);
  const hasMountedRef     = useRef(false);
  const currentPageIdxRef = useRef(currentPageIdx);

  // Keep ref in sync so the rAF loop below always sees the latest value
  // even if currentPageIdx changes before the loop resolves.
  currentPageIdxRef.current = currentPageIdx;

  // Disable browser scroll restoration once on mount so it never overrides
  // our programmatic scrollLeft after a page refresh.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    clearTimeout(unlockTimer.current);

    if (!hasMountedRef.current) {
      // First mount strategy:
      //
      // Two problems to beat simultaneously:
      //   1. el.offsetWidth may be 0 at effect time (element not laid out yet)
      //   2. Browsers restore scroll positions of overflow containers from session
      //      history AFTER the load event — i.e. AFTER useEffect and rAF fire.
      //      window.history.scrollRestoration = 'manual' only guards the window,
      //      not custom overflow divs.
      //
      // Solution: spin on rAF until we have a real width, set scrollLeft, then
      // attach a short-lived 'scroll' guard that resets scrollLeft to the correct
      // position if browser restoration (or anything else) overrides it.
      const restoreGuardRef = { timer: null, fn: null };

      const setInitialScroll = () => {
        const w = el.offsetWidth;
        if (w === 0) {
          requestAnimationFrame(setInitialScroll);
          return;
        }

        const target = currentPageIdxRef.current * w;
        el.scrollLeft = target;
        hasMountedRef.current = true;

        // Guard: if browser scroll restoration fires and overrides our position,
        // snap back immediately. The guard listens for 500ms — well past the
        // window where restoration fires on any major browser.
        const guard = () => {
          el.scrollLeft = currentPageIdxRef.current * el.offsetWidth;
        };
        el.addEventListener('scroll', guard, { passive: true });
        restoreGuardRef.fn = guard;
        restoreGuardRef.timer = setTimeout(() => {
          el.removeEventListener('scroll', guard);
        }, 500);
      };

      requestAnimationFrame(setInitialScroll);

      // Cleanup in case the component unmounts while the guard is still active
      return () => {
        clearTimeout(restoreGuardRef.timer);
        if (restoreGuardRef.fn) el.removeEventListener('scroll', restoreGuardRef.fn);
      };
    } else {
      // Subsequent changes — smooth animation.
      const target = currentPageIdx * el.offsetWidth;
      el.scrollTo({ left: target, behavior: 'smooth' });
      // Timeout-only unlock (scrollend unreliable with touch-action:pan-y)
      unlockTimer.current = setTimeout(() => {}, 600);
    }
  }, [currentPageIdx]);

  return (
    <div
      ref={containerRef}
      className="page-container"
      style={{
        display: 'flex',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        // Disable user horizontal touch gestures — page changes come only from
        // the PageDots pill swipe or arrow buttons, never from swiping content.
        touchAction: 'pan-y',
        WebkitOverflowScrolling: 'touch',
        flex: 1,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
      }}
    >
      {pages.map((page, i) => (
        <div key={page.name || i} style={{
          minWidth: '100%',
          width: '100%',
          scrollSnapAlign: 'start',
          scrollSnapStop: 'always',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {renderPage(page, i)}
        </div>
      ))}
    </div>
  );
}
