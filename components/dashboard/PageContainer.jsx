"use client";
import { useRef, useEffect } from 'react';

/**
 * PageContainer — horizontal scroll-snap container for swipeable pages.
 *
 * Root causes of previous jerk/catch on swipe:
 *
 *   1. `scrollBehavior: smooth` on the container made the CSS snap-into-place
 *      after a user swipe also animate smoothly, which conflicted with the
 *      programmatic scrollTo and the mid-swipe onPageChange calls.
 *      Fix: remove scrollBehavior from CSS; only use behavior:'smooth' in the
 *      explicit scrollTo call so arrow navigation is smooth but swipe snap is
 *      handled natively by the browser.
 *
 *   2. The `onScroll` handler fired mid-swipe (Math.round returns target page
 *      when user is >50% through), calling onPageChange, which triggered the
 *      useEffect, which fired a programmatic smooth scroll while the swipe
 *      gesture was still in progress — two scroll animations colliding.
 *      Fix: use `scrollend` (fires once scroll + snap fully settle) to detect
 *      user swipes instead of the continuous `scroll` event.
 *
 *   3. Multiple rapid arrow clicks left stale unlock timers — fixed by always
 *      clearTimeout before each new programmatic scroll.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const containerRef   = useRef(null);
  const isProgrammatic = useRef(false); // true while arrow/dot navigation is animating
  const unlockTimer    = useRef(null);
  const targetPageRef  = useRef(currentPageIdx);
  const hasMountedRef  = useRef(false); // false on first render, true after

  // ── Programmatic navigation (arrow buttons / PageDots) ───────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    targetPageRef.current = currentPageIdx;
    const target = currentPageIdx * el.offsetWidth;

    clearTimeout(unlockTimer.current);

    if (!hasMountedRef.current) {
      // First mount — assign scrollLeft directly (synchronous, fires no events)
      // so browser scroll-restoration can't override us and trigger scrollend
      // with a stale page index.
      el.scrollLeft = target;
      isProgrammatic.current = false;
    } else {
      // Subsequent index changes (arrow / dot) — animate smoothly.
      isProgrammatic.current = true;
      el.scrollTo({ left: target, behavior: 'smooth' });
      const unlock = () => {
        clearTimeout(unlockTimer.current);
        isProgrammatic.current = false;
      };
      if ('onscrollend' in el) {
        el.addEventListener('scrollend', unlock, { once: true });
      }
      // Fallback: unlock after 600ms in case scrollend never fires
      unlockTimer.current = setTimeout(unlock, 600);
    }

    hasMountedRef.current = true;
  }, [currentPageIdx]);

  // ── User swipe detection ─────────────────────────────────────────────────
  // We listen for `scrollend` (fires after scroll + snap have fully settled)
  // instead of the continuous `scroll` event, so we never call onPageChange
  // while a swipe or programmatic animation is still in progress.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onSettled = () => {
      if (isProgrammatic.current) return; // ignore programmatic scrolls
      const page = Math.round(el.scrollLeft / el.offsetWidth);
      if (page !== targetPageRef.current) {
        targetPageRef.current = page;
        onPageChange(page);
      }
    };

    if ('onscrollend' in el) {
      // Modern Chrome / Firefox — fires exactly once after scroll+snap settle
      el.addEventListener('scrollend', onSettled);
      return () => el.removeEventListener('scrollend', onSettled);
    }

    // Safari fallback — debounce: report 160ms after last scroll event
    let debounce;
    const onScroll = () => {
      if (isProgrammatic.current) return;
      clearTimeout(debounce);
      debounce = setTimeout(onSettled, 160);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(debounce);
    };
  }, [onPageChange]);

  return (
    <div
      ref={containerRef}
      className="page-container"
      style={{
        display: 'flex',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        // No scrollBehavior here — let the browser snap natively after swipe.
        // Programmatic scrollTo uses behavior:'smooth' explicitly (above).
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
