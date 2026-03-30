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
 * Animation is a CSS transition on the track's transform.
 * On first mount the transition is suppressed so there's no sliding-in effect.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx }) {
  const outerRef   = useRef(null);
  const trackRef   = useRef(null);
  const hasMounted = useRef(false);

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

  return (
    <div
      ref={outerRef}
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
