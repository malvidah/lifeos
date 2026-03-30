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
 *   outer (overflow:hidden, flex:1)
 *     track (flex, width = pages.length * 100%, translateX drives paging)
 *       page (width = 100% / pages.length, overflow-y:auto)
 *
 * Animation is a CSS transition on the track's transform.
 * On first mount the transition is suppressed so there's no sliding-in effect.
 *
 * Touch gestures on the content are blocked via touchAction:'pan-y' so that
 * cards with internal horizontal scroll (e.g. Calendar) don't trigger
 * accidental page changes. Page navigation on mobile is via the PageDots pill.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx }) {
  const trackRef    = useRef(null);
  const hasMounted  = useRef(false);

  // On the very first render the track must show the correct page with NO
  // transition (otherwise it slides in from the left on every page load).
  // We achieve this by setting the transition to 'none' for one frame.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    if (!hasMounted.current) {
      track.style.transition = 'none';
      hasMounted.current = true;
      // Re-enable the transition after the browser has painted the initial position
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (trackRef.current) {
            trackRef.current.style.transition =
              'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';
          }
        });
      });
    }
  }, []);

  const n        = pages.length || 1;
  const pct      = currentPageIdx * (100 / n);   // translateX offset in %

  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        flex: 1,
        // Keep the outer wrapper from being a scroll container so the browser
        // has nothing to save/restore scroll positions for.
        touchAction: 'pan-y',
      }}
    >
      <div
        ref={trackRef}
        style={{
          display: 'flex',
          width: `${n * 100}%`,
          height: '100%',
          // Start with no transition; useEffect enables it after mount
          transition: 'none',
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
