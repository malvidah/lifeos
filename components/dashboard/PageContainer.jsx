"use client";
import { useLayoutEffect, useRef, useCallback, useEffect, useState } from 'react';

/**
 * PageContainer — horizontally paginated container using CSS transforms.
 *
 * Layout:
 *   outer (overflow:clip, flex:1, touch-action:pan-y)
 *     track (flex, width = n*100%, translateX drives paging)
 *       page (width = 100%/n, overflow-y:auto, touch-action:pan-y)
 *
 * WHY overflow:clip NOT overflow:hidden:
 * overflow:hidden creates a scroll container the browser can still scroll
 * programmatically (e.g. scrollIntoView from a card initialising its canvas).
 * overflow:clip doesn't create a scroll container at all, so that's impossible.
 *
 * SWIPE STRATEGY:
 *
 * Three input paths — touch, mouse pointer, and trackpad wheel — each handled
 * independently. All three share two context guards:
 *
 *   1. isInsideHorizontalScroll — if the gesture started inside a card that
 *      can scroll horizontally (e.g. the Habits date picker), we let the card
 *      handle it and do NOT change pages.
 *
 *   2. hasTextSelection — if the user has highlighted text (e.g. in Notes),
 *      we treat the gesture as text-selection intent and do NOT change pages.
 *
 * TOUCH (mobile):
 *   touch-action:pan-y lets the browser own vertical scrolling; we get
 *   horizontal events. Fully passive listeners — no preventDefault needed.
 *   Decide at touchend: enough horizontal distance and not too vertical.
 *
 * POINTER/MOUSE (desktop click-drag):
 *   setPointerCapture ensures pointerup fires even if cursor leaves the element.
 *   Decide at pointerup.
 *
 * WHEEL (trackpad two-finger swipe):
 *   Trackpad horizontal swipes fire `wheel` events (deltaX), NOT touch/pointer.
 *   A single physical swipe produces a burst of events; we navigate once and
 *   then ignore further wheel events for 500ms (matching the CSS transition).
 *
 * Animation: CSS transition on the track's transform, suppressed on first mount
 * via useLayoutEffect so there's no slide-in effect.
 */

/**
 * Returns true if `el` (or any ancestor up to `boundary`) is a container that
 * can actually scroll horizontally — i.e. overflowX is scroll/auto AND the
 * content is wider than the box. This guards against navigating pages when
 * the user is interacting with a horizontally scrollable card region.
 */
function isInsideHorizontalScroll(el, boundary) {
  while (el && el !== boundary) {
    const ox = window.getComputedStyle(el).overflowX;
    if ((ox === 'scroll' || ox === 'auto') && el.scrollWidth > el.clientWidth) {
      return true;
    }
    el = el.parentElement;
  }
  return false;
}

/** Returns true if the user currently has text highlighted. */
function hasTextSelection() {
  return !!window.getSelection?.()?.toString();
}

export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const outerRef = useRef(null);
  const trackRef = useRef(null);

  const TRANSITION = 'transform 0.38s cubic-bezier(0.4, 0, 0.2, 1)';

  // Suppress the CSS transition on first mount so there's no slide-in animation.
  // Using state means React manages `transition` in the style prop — no risk of
  // it being overwritten on re-render the way an imperative style.transition would be.
  const [transitionReady, setTransitionReady] = useState(false);
  useLayoutEffect(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setTransitionReady(true));
    });
  }, []);

  const n   = pages.length || 1;
  const pct = currentPageIdx * (100 / n);

  // ── Stable refs so effects never need to re-mount ────────────────────────
  const onPageChangeRef = useRef(onPageChange);
  onPageChangeRef.current = onPageChange;
  const currentIdxRef = useRef(currentPageIdx);
  currentIdxRef.current = currentPageIdx;
  const pageCountRef = useRef(n);
  pageCountRef.current = n;

  // ── Touch swipe (mobile) — fully passive, decide at touchend ─────────────
  const touchRef = useRef(null);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      // Don't swipe pages if the touch started inside a horizontally scrollable card
      if (isInsideHorizontalScroll(e.target, outer)) return;
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY };
    };

    const onTouchEnd = (e) => {
      if (!touchRef.current) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;
      touchRef.current = null;
      if (Math.abs(dx) < 40) return;                     // too short
      if (Math.abs(dy) > Math.abs(dx) * 0.75) return;   // too vertical
      if (hasTextSelection()) return;                     // user is selecting text
      const idx   = currentIdxRef.current;
      const total = pageCountRef.current;
      const newIdx = dx < 0
        ? Math.min(idx + 1, total - 1)
        : Math.max(idx - 1, 0);
      if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
    };

    const onTouchCancel = () => { touchRef.current = null; };

    outer.addEventListener('touchstart', onTouchStart, { passive: true });
    outer.addEventListener('touchend',   onTouchEnd,   { passive: true });
    outer.addEventListener('touchcancel',onTouchCancel,{ passive: true });

    return () => {
      outer.removeEventListener('touchstart', onTouchStart);
      outer.removeEventListener('touchend',   onTouchEnd);
      outer.removeEventListener('touchcancel',onTouchCancel);
    };
  }, []);

  // ── Pointer swipe (desktop mouse click-drag) ─────────────────────────────
  const pointerRef = useRef(null);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    // Don't track drags that start inside a horizontally scrollable card
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
    if (hasTextSelection()) return;                      // user dragged to select text
    const idx   = currentIdxRef.current;
    const total = pageCountRef.current;
    const newIdx = dx < 0
      ? Math.min(idx + 1, total - 1)
      : Math.max(idx - 1, 0);
    if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
  }, []);

  const handlePointerCancel = useCallback(() => {
    pointerRef.current = null;
  }, []);

  // ── Trackpad two-finger swipe (wheel events) ─────────────────────────────
  // Trackpad horizontal swipes fire `wheel` events with deltaX — they are NOT
  // touch or pointer events. A single physical swipe produces a burst of events
  // that can have multiple peaks (momentum). We use two separate mechanisms:
  //
  //   hasNavigated — flips true on first qualifying event, preventing any
  //   further navigation within the same gesture burst.
  //
  //   idleTimer — debounced: resets on every qualifying event, expires only
  //   after wheel events have been absent for 350ms (gesture truly finished).
  //   Only then does hasNavigated reset, allowing the next swipe.
  //
  // This is more robust than a fixed cooldown, which can either fire too soon
  // (double-skip) or block a fast second intentional swipe for too long.
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    let hasNavigated = false;
    let idleTimer    = null;

    const onWheel = (e) => {
      // Only handle gestures that are more horizontal than vertical
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (Math.abs(e.deltaX) < 10) return;  // ignore tiny nudges
      // If the wheel event came from inside a horizontally scrollable card,
      // let that card consume the scroll rather than changing pages
      if (isInsideHorizontalScroll(e.target, outer)) return;

      // Debounce: extend the idle window on every qualifying event
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer    = null;
        hasNavigated = false;  // gesture is done — allow the next swipe
      }, 350);

      // Only navigate once per burst
      if (hasNavigated) return;
      hasNavigated = true;

      const idx   = currentIdxRef.current;
      const total = pageCountRef.current;
      const newIdx = e.deltaX > 0
        ? Math.min(idx + 1, total - 1)
        : Math.max(idx - 1, 0);
      if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
    };

    outer.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      outer.removeEventListener('wheel', onWheel);
      if (idleTimer) clearTimeout(idleTimer);
    };
  }, []);

  return (
    <div
      ref={outerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{
        position: 'relative',
        overflow: 'clip',
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
          transform: `translateX(-${pct}%)`,
          transition: transitionReady ? TRANSITION : 'none',
          willChange: 'transform',
        }}
      >
        {pages.map((page, i) => (
          <div
            key={page.name || i}
            style={{
              width: `${100 / n}%`,
              minWidth: `${100 / n}%`,
              height: '100%',
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
