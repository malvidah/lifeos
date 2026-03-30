"use client";
import { useRef, useEffect, useCallback } from 'react';

/**
 * PageContainer — horizontal scroll-snap container for swipeable pages.
 *
 * Props:
 *   pages           Array<page>
 *   renderPage      (page, index) => ReactNode
 *   currentPageIdx  number
 *   onPageChange    (index: number) => void
 *   editMode        boolean  — passed through; swipe stays enabled in edit mode
 *                             so users can switch pages while editing layout
 *
 * Navigation reliability notes:
 *   - scrollTimerRef is always cleared before a new scroll starts, so rapid
 *     arrow clicks never leave stale "unlock" timers that fire mid-animation.
 *   - targetPageRef tracks where we *intend* to land; handleScroll ignores
 *     intermediate positions that don't match, preventing the 1→3 reset bug.
 *   - 'scrollend' is used when available (modern browsers) for a precise
 *     unlock signal instead of the fixed 500ms fallback.
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange, editMode }) {
  const containerRef   = useRef(null);
  const isScrollingRef = useRef(false);
  const scrollTimerRef = useRef(null);   // single timer — cleared on every new scroll
  const targetPageRef  = useRef(currentPageIdx); // where we intend to land

  // Programmatic scroll — fires when currentPageIdx changes via arrow / PageDots
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    targetPageRef.current = currentPageIdx;
    const target = currentPageIdx * el.offsetWidth;

    if (Math.abs(el.scrollLeft - target) > 2) {
      // Clear any previous unlock timer before starting a fresh scroll
      clearTimeout(scrollTimerRef.current);
      isScrollingRef.current = true;
      el.scrollTo({ left: target, behavior: 'smooth' });

      // Fallback unlock — use scrollend if supported, else fixed timeout
      const unlock = () => { isScrollingRef.current = false; };
      if ('onscrollend' in el) {
        el.addEventListener('scrollend', unlock, { once: true });
      } else {
        scrollTimerRef.current = setTimeout(unlock, 500);
      }
    } else {
      // Already at target — ensure lock is cleared
      clearTimeout(scrollTimerRef.current);
      isScrollingRef.current = false;
    }
  }, [currentPageIdx]);

  // Detect page changes from user swipe via scroll position.
  // Only fires for genuine user gestures (isScrollingRef gate) and only
  // calls onPageChange when the settled page differs from the intended target
  // (prevents mid-animation intermediate positions from resetting the index).
  const handleScroll = useCallback(() => {
    if (isScrollingRef.current) return;
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return;
    const page = Math.round(el.scrollLeft / el.offsetWidth);
    if (page !== targetPageRef.current) {
      targetPageRef.current = page;
      onPageChange(page);
    }
  }, [onPageChange]);

  return (
    <div
      ref={containerRef}
      className="page-container"
      onScroll={handleScroll}
      style={{
        display: 'flex',
        overflowX: 'auto',
        scrollSnapType: 'x mandatory',
        scrollBehavior: 'smooth',
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
