"use client";
import { useState, useEffect, useCallback } from "react";
import { mono, F } from "@/lib/tokens";

const COMMANDS = [
  { key: "/h", desc: "Habit (daily, M\u00B7W\u00B7F, etc.)" },
  { key: "/r", desc: "Repeat (recurring task)" },
  { key: "/p or #", desc: "Project tag" },
  { key: "/l", desc: "Location" },
  { key: "/d or @", desc: "Due date" },
  { key: "/n", desc: "Note link" },
  { key: "/m", desc: "Media / image" },
];

const NAVIGATION = [
  { key: "\u2190 \u2192", desc: "Navigate days" },
  { key: "Click date", desc: "Go to today" },
  { key: "Click habit", desc: "Detail view" },
];

export default function ShortcutCheatsheet() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen(p => !p), []);
  const close = useCallback(() => setOpen(false), []);

  // Listen for ? key (not inside inputs) and Escape to dismiss
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      const editable = tag === "INPUT" || tag === "TEXTAREA" || document.activeElement?.isContentEditable;

      if (e.key === "Escape" && open) {
        e.preventDefault();
        close();
        return;
      }

      if (e.key === "?" && !editable) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, toggle, close]);

  return (
    <>
      {/* Floating ? button — bottom-right, above the chat bar */}
      <button
        onClick={toggle}
        aria-label="Keyboard shortcuts"
        style={{
          position: "fixed", bottom: 80, right: 16, zIndex: 97,
          width: 32, height: 32, borderRadius: "50%",
          background: "var(--dl-surface, rgba(30,28,24,0.7))",
          border: "1px solid var(--dl-border, rgba(128,120,100,0.15))",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          color: "var(--dl-middle)", fontFamily: mono, fontSize: 14,
          fontWeight: 600, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "opacity 0.15s, transform 0.15s",
          opacity: open ? 0 : 0.6,
          pointerEvents: open ? "none" : "auto",
        }}
        onMouseOver={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = "scale(1.1)"; }}
        onMouseOut={e => { e.currentTarget.style.opacity = open ? "0" : "0.6"; e.currentTarget.style.transform = "scale(1)"; }}
      >
        ?
      </button>

      {/* Overlay */}
      {open && (
        <div
          onClick={close}
          style={{
            position: "fixed", inset: 0, zIndex: 9998,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.5)",
            backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
            animation: "dlCheatFade 0.2s ease",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: "var(--dl-surface, rgba(30,28,24,0.9))",
              border: "1px solid var(--dl-border, rgba(128,120,100,0.15))",
              borderRadius: 16, padding: "28px 32px 24px",
              maxWidth: 420, width: "90%",
              backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
              animation: "dlCheatScale 0.2s ease",
            }}
          >
            {/* Two-column layout */}
            <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
              {/* Commands column */}
              <div style={{ flex: "1 1 160px", minWidth: 160 }}>
                <div style={{
                  fontFamily: mono, fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "var(--dl-accent)", marginBottom: 12,
                }}>
                  Commands
                </div>
                {COMMANDS.map(c => (
                  <div key={c.key} style={{ display: "flex", gap: 10, marginBottom: 7, alignItems: "baseline" }}>
                    <span style={{
                      fontFamily: mono, fontSize: F.sm, fontWeight: 600,
                      color: "var(--dl-strong)", minWidth: 56, flexShrink: 0,
                    }}>
                      {c.key}
                    </span>
                    <span style={{
                      fontFamily: mono, fontSize: F.sm,
                      color: "var(--dl-middle)", letterSpacing: "0.02em",
                    }}>
                      {c.desc}
                    </span>
                  </div>
                ))}
              </div>

              {/* Navigation column */}
              <div style={{ flex: "1 1 140px", minWidth: 140 }}>
                <div style={{
                  fontFamily: mono, fontSize: 10, fontWeight: 600,
                  letterSpacing: "0.12em", textTransform: "uppercase",
                  color: "var(--dl-accent)", marginBottom: 12,
                }}>
                  Navigation
                </div>
                {NAVIGATION.map(c => (
                  <div key={c.key} style={{ display: "flex", gap: 10, marginBottom: 7, alignItems: "baseline" }}>
                    <span style={{
                      fontFamily: mono, fontSize: F.sm, fontWeight: 600,
                      color: "var(--dl-strong)", minWidth: 72, flexShrink: 0,
                    }}>
                      {c.key}
                    </span>
                    <span style={{
                      fontFamily: mono, fontSize: F.sm,
                      color: "var(--dl-middle)", letterSpacing: "0.02em",
                    }}>
                      {c.desc}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Dismiss hint */}
            <div style={{
              fontFamily: mono, fontSize: 10, color: "var(--dl-middle)",
              letterSpacing: "0.08em", textAlign: "center",
              marginTop: 18, opacity: 0.5,
            }}>
              press ? or Esc to close
            </div>
          </div>

          <style>{`
            @keyframes dlCheatFade {
              from { opacity: 0; }
              to   { opacity: 1; }
            }
            @keyframes dlCheatScale {
              from { opacity: 0; transform: scale(0.96) translateY(6px); }
              to   { opacity: 1; transform: scale(1) translateY(0); }
            }
          `}</style>
        </div>
      )}
    </>
  );
}
