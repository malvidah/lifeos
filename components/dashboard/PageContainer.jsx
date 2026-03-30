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
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const containerRef   = useRef(null);
  const unlockTimer    = useRef(null);
  const hasMountedRef  = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const target = currentPageIdx * el.offsetWidth;
    clearTimeout(unlockTimer.current);

    if (!hasMountedRef.current) {
      // First mount — set synchronously (no events fired) so browser
      // scroll-restoration can't override currentPageIdx.
      el.scrollLeft = target;
    } else {
      // Subsequent changes — smooth animation.
      el.scrollTo({ left: target, behavior: 'smooth' });
      // Timeout-only unlock (scrollend unreliable with touch-action:pan-y)
      unlockTimer.current = setTimeout(() => {}, 600);
    }

    hasMountedRef.current = true;
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
