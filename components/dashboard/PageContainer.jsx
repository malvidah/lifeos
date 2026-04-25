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
    if (e.target.closest('[data-no-page-swipe]')) return;
    // Don't capture at pointerdown — capturing immediately redirects the
    // synthetic click event to the outer div, breaking any clickable element
    // inside (custom divs, non-button interactive elements, etc.).
    // Capture lazily in pointermove once a real horizontal drag is confirmed.
    pointerRef.current = { x: e.clientX, y: e.clientY, pointerId: e.pointerId, dragging: false };
  }, []);

  const handlePointerMove = useCallback((e) => {
    if (!pointerRef.current || pointerRef.current.dragging) return;
    const dx = Math.abs(e.clientX - pointerRef.current.x);
    if (dx > 10) {
      pointerRef.current.dragging = true;
      outerRef.current?.setPointerCapture(pointerRef.current.pointerId);
    }
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
  // One navigation per physical gesture.
  //
  // Calibrated from real MacBook trackpad data on a rapid double-swipe:
  //   momentum events : ~8ms apart, dx slowly decelerating (57→26→24→7→...)
  //   inter-gesture   : 35ms gap, dx immediately dropped to 26 from 57 (-55%)
  //   new gesture     : dx valley at 7px, then ramped up (7→28→51→72→99)
  //
  // Two complementary unlock conditions (either fires the unlock):
  //
  //  GAP + DROP  — a timing gap of ≥30ms where velocity also dropped ≥40%.
  //                Pure reflow jitter can create a >25ms gap but won't cause
  //                a simultaneous 40%+ velocity drop; the real inter-gesture
  //                gap hits both (35ms gap + 55% velocity drop).
  //
  //  VALLEY + SURGE — momentum velocity fell below DYING_THRESHOLD (12px),
  //                then a new event arrives ≥ SURGE_THRESHOLD (30px).
  //                This is the unmistakable "lift fingers, place again" shape.
  useEffect(() => {
    const outer = outerRef.current;
    if (!outer) return;

    const GAP_MS         = 30;   // ms gap needed for gap+drop unlock
    const DROP_RATIO     = 0.60; // new event must be < 60% of last to pair with gap
    const DYING_THRESHOLD = 12;  // px — momentum is dying when events drop here
    const SURGE_THRESHOLD = 30;  // px — new gesture confirmed when velocity surges here

    let gestureNavigated = false;
    let accDeltaX        = 0;
    let lastEventTime    = 0;
    let lastLockedDelta  = 0; // last delta seen while locked (for gap+drop check)
    let momentumDying    = false;
    let idleTimer        = null;

    const onWheel = (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      if (isInsideHorizontalScroll(e.target, outer)) return;
      // NOTE: intentionally NOT checking data-no-page-swipe here.
      // data-no-page-swipe blocks touch/pointer drags from conflicting with
      // cards that handle their own horizontal gestures (e.g. day strip).
      // Those cards use mouse/touch drag — not wheel events — so trackpad
      // two-finger swipes should still navigate pages even over those areas.

      const now      = Date.now();
      const absDelta = Math.abs(e.deltaX);

      if (gestureNavigated) {
        const gap     = lastEventTime > 0 ? now - lastEventTime : 0;
        lastEventTime = now;

        const gapUnlock   = gap >= GAP_MS && absDelta < lastLockedDelta * DROP_RATIO;
        const surgeUnlock = momentumDying && absDelta >= SURGE_THRESHOLD;

        if (gapUnlock || surgeUnlock) {
          gestureNavigated = false;
          momentumDying    = false;
          accDeltaX        = 0;
          lastLockedDelta  = 0;
          if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
          if (absDelta < 3) return;
          // fall through to accumulate this event as start of new gesture
        } else {
          if (absDelta < DYING_THRESHOLD) momentumDying = true;
          lastLockedDelta = absDelta;
          return;
        }
      }

      lastEventTime = now;
      if (absDelta < 3) return;

      // Idle timer: reset partial accumulation after a quiet pause
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer     = null;
        accDeltaX     = 0;
        lastEventTime = 0;
      }, 100);

      accDeltaX += e.deltaX;
      if (Math.abs(accDeltaX) < 60) return;

      gestureNavigated = true;
      momentumDying    = false;
      lastLockedDelta  = absDelta;
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }

      const idx    = currentIdxRef.current;
      const total  = pageCountRef.current;
      const newIdx = accDeltaX > 0 ? Math.min(idx + 1, total - 1) : Math.max(idx - 1, 0);
      if (newIdx !== idx) onPageChangeRef.current?.(newIdx);
    };

    outer.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      outer.removeEventListener('wheel', onWheel);
      if (idleTimer) clearTimeout(idleTimer);
    };
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
      onPointerMove={handlePointerMove}
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
            key={page.id || `idx-${i}`}
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
