"use client";
import { useEffect, useRef, useState } from "react";
import { mono, F } from "@/lib/tokens";

/**
 * Tip — small floating tooltip for contextual first-action hints.
 *
 * Props:
 *   visible    — boolean, whether to render
 *   message    — string to display
 *   anchorRef  — React ref to the trigger element (used for positioning)
 *   anchorRect — alternative: pass a DOMRect directly (e.g. from getBoundingClientRect)
 *   position   — "above" | "below" (default "above")
 *   onDismiss  — called when user clicks x or auto-dismiss fires
 */
export default function Tip({ visible, message, anchorRef, anchorRect, position = "above", onDismiss }) {
  const tipRef = useRef(null);
  const [coords, setCoords] = useState(null);

  // Compute position from anchor
  useEffect(() => {
    if (!visible) { setCoords(null); return; }

    const compute = () => {
      const rect = anchorRect || anchorRef?.current?.getBoundingClientRect();
      if (!rect) return;
      const tipW = 280;
      const tipH = 48;
      const gap = 8;

      let top, left;
      if (position === "below") {
        top = rect.bottom + gap;
      } else {
        top = rect.top - tipH - gap;
      }
      // Center horizontally on the anchor, clamped to viewport
      left = rect.left + rect.width / 2 - tipW / 2;
      left = Math.max(12, Math.min(left, window.innerWidth - tipW - 12));
      // Clamp top
      top = Math.max(12, Math.min(top, window.innerHeight - tipH - 12));

      setCoords({ top, left, arrowLeft: rect.left + rect.width / 2 - left });
    };

    compute();
    // Recompute on scroll/resize
    window.addEventListener("scroll", compute, true);
    window.addEventListener("resize", compute);
    return () => {
      window.removeEventListener("scroll", compute, true);
      window.removeEventListener("resize", compute);
    };
  }, [visible, anchorRef, anchorRect, position]);

  if (!visible || !coords) return null;

  const arrowSize = 6;
  const isBelow = position === "below";

  return (
    <div
      ref={tipRef}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        zIndex: 9998,
        maxWidth: 280,
        padding: "8px 12px",
        paddingRight: 28,
        borderRadius: 8,
        fontFamily: mono,
        fontSize: F.sm,
        lineHeight: 1.45,
        letterSpacing: "0.02em",
        color: "var(--dl-strong)",
        background: "var(--dl-surface, var(--dl-card, rgba(40,38,34,0.92)))",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid var(--dl-border)",
        boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
        pointerEvents: "auto",
        animation: `tipEnter 0.25s ease both`,
      }}
    >
      {message}

      {/* Dismiss button */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss tip"
        style={{
          position: "absolute",
          top: 6,
          right: 6,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--dl-middle)",
          fontFamily: mono,
          fontSize: 11,
          lineHeight: 1,
          padding: "2px 4px",
          borderRadius: 4,
          transition: "color 0.15s",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "var(--dl-strong)")}
        onMouseLeave={e => (e.currentTarget.style.color = "var(--dl-middle)")}
      >
        &times;
      </button>

      {/* Arrow pointing to trigger */}
      <div
        style={{
          position: "absolute",
          [isBelow ? "top" : "bottom"]: -arrowSize,
          left: Math.max(12, Math.min(coords.arrowLeft, 268)),
          width: 0,
          height: 0,
          borderLeft: `${arrowSize}px solid transparent`,
          borderRight: `${arrowSize}px solid transparent`,
          ...(isBelow
            ? { borderBottom: `${arrowSize}px solid var(--dl-border)` }
            : { borderTop: `${arrowSize}px solid var(--dl-border)` }),
        }}
      />

      {/* Inject keyframes once */}
      <style>{`
        @keyframes tipEnter {
          from { opacity: 0; transform: translateY(${isBelow ? "-6px" : "6px"}); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
