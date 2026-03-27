"use client";
import { useState, useEffect } from "react";
import { mono, F } from "@/lib/tokens";

const STORAGE_KEY = "daylab:welcomed";

export default function WelcomeOverlay() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch {}
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch {}
    setVisible(false);
  };

  return (
    <div
      onClick={dismiss}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
        animation: "dlWelcomeFade 0.4s ease",
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "var(--dl-surface, rgba(30,28,24,0.85))",
          border: "1px solid var(--dl-border, rgba(128,120,100,0.15))",
          borderRadius: 20, padding: "40px 36px 32px",
          maxWidth: 380, width: "90%", textAlign: "center",
          backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)",
          animation: "dlWelcomeScale 0.4s ease",
        }}
      >
        <div style={{
          fontFamily: mono, fontSize: F.lg, fontWeight: 600,
          color: "var(--dl-strong)", letterSpacing: "0.04em",
          marginBottom: 10,
        }}>
          Welcome to Day Lab
        </div>
        <div style={{
          fontFamily: mono, fontSize: F.sm,
          color: "var(--dl-middle)", letterSpacing: "0.04em",
          lineHeight: 1.6, marginBottom: 28,
        }}>
          Your daily life dashboard.<br />Everything starts with today.
        </div>
        <button
          onClick={dismiss}
          style={{
            fontFamily: mono, fontSize: F.sm, fontWeight: 600,
            letterSpacing: "0.08em", textTransform: "uppercase",
            background: "var(--dl-accent)", color: "#fff",
            border: "none", borderRadius: 10,
            padding: "10px 32px", cursor: "pointer",
            transition: "opacity 0.15s",
          }}
          onMouseOver={e => e.currentTarget.style.opacity = "0.85"}
          onMouseOut={e => e.currentTarget.style.opacity = "1"}
        >
          Get Started
        </button>
      </div>

      <style>{`
        @keyframes dlWelcomeFade {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes dlWelcomeScale {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
