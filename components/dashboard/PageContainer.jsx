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
 *   editMode        boolean  — when true, swipe/scroll is disabled so the user
 *                             can drag cards without accidentally changing pages
 */
export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange, editMode }) {
  const containerRef    = useRef(null);
  const isScrollingRef  = useRef(false);

  // Scroll to page programmatically when currentPageIdx changes externally
  useEffect(() => {
    if (editMode) return; // don't animate away from current page while editing
    const el = containerRef.current;
    if (!el) return;
    const target = currentPageIdx * el.offsetWidth;
    if (Math.abs(el.scrollLeft - target) > 2) {
      isScrollingRef.current = true;
      el.scrollTo({ left: target, behavior: 'smooth' });
      setTimeout(() => { isScrollingRef.current = false; }, 400);
    }
  }, [currentPageIdx, editMode]);

  // Detect page changes from user swipe via scroll position
  const handleScroll = useCallback(() => {
    if (editMode) return;           // ignore scroll events during layout edit
    if (isScrollingRef.current) return;
    const el = containerRef.current;
    if (!el || !el.offsetWidth) return;
    const page = Math.round(el.scrollLeft / el.offsetWidth);
    onPageChange(page);
  }, [onPageChange, editMode]);

  return (
    <div
      ref={containerRef}
      className="page-container"
      onScroll={handleScroll}
      style={{
        display: 'flex',
        overflowX: editMode ? 'hidden' : 'auto',  // freeze swipe in edit mode
        scrollSnapType: editMode ? 'none' : 'x mandatory',
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
