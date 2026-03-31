"use client";
import { useLayoutEffect, useRef, useCallback, useEffect } from 'react';

/**
 * PageContainer — horizontally paginated container using CSS transforms.
 *
 * Layout:
 *   outer (overflow:hidden, flex:1, touch-action:pan-y)
 *     track (flex, width=n*100%, translateX drives paging)
 *       page (width=100%/n, overflow-y:auto, touch-action:pan-y)
 *
 * WHY overflow:hidden (not clip):
 * overflow:hidden makes the outer a scroll container. scrollIntoView() from
 * cards will try to scroll the outer instead of the page divs. The scroll
 * lock below immediately resets the outer to (0,0), so no card can disturb
 * the paging position. With overflow:clip the outer is NOT a scroll container,
 * so scrollIntoView() falls through to the page divs, which have no lock —
 * content gets permanently clipped on mobile.
 *
 * TRANSITION:
 * Managed entirely imperatively so React never fights us during drag.
 * React owns `transform` (which page), we own `transition` (animation).
 *
 * SWIPE:
 * Touch: real-time drag in touchmove, snap/navigate at touchend.
 * Mouse: pointerdown/up with setPointerCapture.
 * Trackpad: wheel events with debounced idle timer (one nav per gesture).
 * All three guard against horizontal-scrollable cards and text selection.
 */

function isInsideHorizontalScroll(el, boundary) {
  while (el && el !== boundary) {
    const ox = window.getComputedStyle(el).overflowX;
    if ((ox === 'scroll' || ox === 'auto') && el.scrollWidth > el.clientWidth) return true;
    el = el.parentElement;
  }
  return false;
}

function hasTextSelection() {
  return !!window.getSelection?.()?.toString();
}

const TRANSITION = 'transform 0.28s cubic-bezier(0.33, 1, 0.68, 1)';

export default function PageContainer({ pages, renderPage, currentPageIdx, onPageChange }) {
  const outerRef = useRef(null);
  const trackRef = useRef(null);

  const n   = pages.length || 1;
  const pct = currentPageIdx * (100 / n);

  const onPageChangeRef  = useRef(onPageChange);  onPageChangeRef.current  = onPageChange;
  const currentIdxRef    = useRef(currentPageIdx); currentIdxRef.current    = currentPageIdx;
  const pageCountRef     = useRef(n);              pageCountRef.current     = n;

  // ── Transition (imperative — React never touches this property) ───────────
  // Suppress on first mount so there's no slide-in. Re-enable after 2 rAFs.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    track.style.transition = 'none';
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (trackRef.current) trackRef.current.style.transition = TRANSITION;
      });
    });
  }, []);

  // ── Scroll lock ───────────────────────────────────────────────────────────
  // overflow:hidden makes the outer a scroll container. Any scrollIntoView()
  // call from a card will try to scroll the outer; we immediately reset it.
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

  // ── Touch swipe (mobile) — real-time drag + snap/navigate at touchend ────
  const touchRef = useRef(null);

  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const onTouchStart = (e) => {
      if (e.touches.length !== 1) return;
      if (isInsideHorizontalScroll(e.target, outer)) return;
      if (e.target.closest('[data-no-page-swipe]')) return;
      const t = e.touches[0];
      touchRef.current = { x: t.clientX, y: t.clientY, dx: 0, horizontal: false };
    };

    const onTouchMove = (e) => {
      if (!touchRef.current) return;
      const t  = e.touches[0];
      const dx = t.clientX - touchRef.current.x;
      const dy = t.clientY - touchRef.current.y;

      if (!touchRef.current.horizontal) {
        // Cancel if gesture is clearly vertical
        if (Math.abs(dy) > Math.abs(dx) * 1.5 && Math.abs(dy) > 8) {
          touchRef.current = null;
          return;
        }
        if (Math.abs(dx) > 8) touchRef.current.horizontal = true;
      }

      if (touchRef.current.horizontal) {
        touchRef.current.dx = dx;
        const p = currentIdxRef.current * (100 / pageCountRef.current);
        if (trackRef.current) {
          trackRef.current.style.transition = 'none';
          trackRef.current.style.transform  = `translateX(calc(-${p}% + ${dx}px))`;
        }
      }
    };

    const snapTo = (newIdx) => {
      const newPct = newIdx * (100 / pageCountRef.current);
      if (trackRef.current) {
        trackRef.current.style.transition = TRANSITION;
        trackRef.current.style.transform  = `translateX(-${newPct}%)`;
      }
      if (newIdx !== currentIdxRef.current) onPageChangeRef.current?.(newIdx);
    };

    const onTouchEnd = () => {
      if (!touchRef.current) return;
      const { dx } = touchRef.current;
      touchRef.current = null;

      const idx = currentIdxRef.current;
      const n   = pageCountRef.current;

      if (Math.abs(dx) < 40 || hasTextSelection()) { snapTo(idx); return; }

      snapTo(dx < 0 ? Math.min(idx + 1, n - 1) : Math.max(idx - 1, 0));
    };

    const onTouchCancel = () => {
      if (touchRef.current) {
        snapTo(currentIdxRef.current);
        touchRef.current = null;
      }
    };

    outer.addEventListener('touchstart',  onTouchStart,  { passive: true });
    outer.addEventListener('touchmove',   onTouchMove,   { passive: true });
    outer.addEventListener('touchend',    onTouchEnd,    { passive: true });
    outer.addEventListener('touchcancel', onTouchCancel, { passive: true });
    return () => {
      outer.removeEventListener('touchstart',  onTouchStart);
      outer.removeEventListener('touchmove',   onTouchMove);
      outer.removeEventListener('touchend',    onTouchEnd);
      outer.removeEventListener('touchcancel', onTouchCancel);
    };
  }, []);

  // ── Pointer swipe (desktop mouse) ─────────────────────────────────────────
  const pointerRef = useRef(null);

  const handlePointerDown = useCallback((e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button !== 0) return;
    if (isInsideHorizontalScroll(e.target, outerRef.current)) return;
    // Don't capture pointer for interactive element clicks.
    // setPointerCapture redirects subsequent pointer events to the outer div,
    // which on trackpads causes pointerleave to fire on the clicked element
    // mid-press (micro-movement under physical click pressure), making the
    // click miss its target or require two presses. Swipes always start from
    // non-interactive areas so skipping capture here doesn't break swipe nav.
    if (e.target.closest('button, a, input, textarea, select, [role="button"], [role="switch"], [role="checkbox"], [role="tab"]')) return;
    // Also skip pointer capture for areas that own their own click/drag interactions.
    // data-no-page-swipe = area handles horizontal gestures (day scroller, etc.)
    // data-no-pointer-capture = area has clickable non-button divs that break when
    //   pointer capture reassigns click dispatch to the outer container instead.
    if (e.target.closest('[data-no-page-swipe], [data-no-pointer-capture]')) return;
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
    if (hasTextSelection()) return;
    const idx   = currentIdxRef.current;
    const total = pageCountRef.current;
    const newIdx = dx < 0 ? Math.min(idx + 1, total - 1) : Math.max(idx - 1, 0);
    if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
  }, []);

  const handlePointerCancel = useCallback(() => { pointerRef.current = null; }, []);

  // ── Trackpad two-finger swipe (wheel events) ──────────────────────────────
  // Two-state machine:
  //   READY  — accumulate deltaX; navigate when ≥60px threshold is crossed.
  //   LOCKED — after a navigation, stay locked while momentum events keep
  //            arriving; unlock only after 200ms of silence so leftover
  //            inertia can never push accDeltaX past the threshold again.
  // This avoids both the "cursor must move" bug (old idle-timer approach let
  // momentum keep resetting hasNavigated) and the "double-page" bug (fixed
  // lockout expired while momentum was still active).
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    let locked    = false;
    let accDeltaX = 0;
    let idleTimer = null;

    const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } };

    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (Math.abs(e.deltaX) < 3) return;
      if (isInsideHorizontalScroll(e.target, outer)) return;
      if (e.target.closest('[data-no-page-swipe]')) return;

      if (locked) {
        // Momentum events extend the unlock timer; we stay locked until
        // 200ms after the last event so they can't cause a second navigation.
        clearIdle();
        idleTimer = setTimeout(() => { idleTimer = null; locked = false; accDeltaX = 0; }, 200);
        return;
      }

      accDeltaX += e.deltaX;

      // Idle timer resets the accumulator if the gesture pauses without reaching threshold
      clearIdle();
      idleTimer = setTimeout(() => { idleTimer = null; accDeltaX = 0; }, 200);

      if (Math.abs(accDeltaX) < 60) return;

      const idx    = currentIdxRef.current;
      const total  = pageCountRef.current;
      const newIdx = accDeltaX > 0 ? Math.min(idx + 1, total - 1) : Math.max(idx - 1, 0);

      clearIdle();
      accDeltaX = 0;

      if (newIdx !== idx) {
        locked = true;
        onPageChangeRef.current?.(newIdx);
        // Seed the unlock timer; momentum events will keep extending it
        idleTimer = setTimeout(() => { idleTimer = null; locked = false; }, 200);
      }
    };

    outer.addEventListener('wheel', onWheel, { passive: true });
    return () => { outer.removeEventListener('wheel', onWheel); clearIdle(); };
  }, []);

  // ── Arrow key navigation ──────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e) => {
      // Don't steal keys from text inputs
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const newIdx = Math.max(0, currentIdxRef.current - 1);
        if (newIdx !== currentIdxRef.current) onPageChangeRef.current?.(newIdx);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const newIdx = Math.min(pageCountRef.current - 1, currentIdxRef.current + 1);
        if (newIdx !== currentIdxRef.current) onPageChangeRef.current?.(newIdx);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div
      ref={outerRef}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      style={{ position: 'relative', overflow: 'hidden', flex: 1, touchAction: 'pan-y' }}
    >
      <div
        ref={trackRef}
        style={{
          display: 'flex',
          width: `${n * 100}%`,
          height: '100%',
          transform: `translateX(-${pct}%)`,
          willChange: 'transform',
          // transition is managed imperatively — not here
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
              // No touchAction here — the outer's pan-y already governs the
              // whole subtree. Setting it again on page divs confuses iOS Safari
              // into not passing horizontal swipes from empty background areas
              // up to our outer-level touch listeners.
            }}
          >
            {renderPage(page, i)}
          </div>
        ))}
      </div>
    </div>
  );
}
