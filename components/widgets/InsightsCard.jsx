"use client";
import { useState, useEffect, useRef } from "react";
import { useTheme } from "../theme/ThemeContext.jsx";
import { mono, serif, F, R } from "../theme/tokens.js";
import { dbLoad } from "../utils/db.js";
import { Card, ChevronBtn, Shimmer } from "../ui/index.jsx";
export function InsightsCard({date, token, userId, healthKey, collapsed, onToggle}) {
  const { C } = useTheme();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [isFree, setIsFree] = useState(false);
  const [freeUsage, setFreeUsage] = useState(null); // { count, limit }
  const prevDate = useRef(date);
  const generatedWithKey = useRef(null); // healthKey used for last generation, null = not yet
  const waitTimer = useRef(null);

  const BAD_VALUES = ["No data available", "No insights generated", "AI error"];

  function cleanInsight(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(.+?)\*/g, '$1')
      .replace(/^#{1,3}\s+/gm, '')
      .replace(/^[A-Za-z]+,\s+\w+ \d+\n+/, '')
      .trim();
  }

  function isBadCache(t, cached, currentHealthKey) {
    if (!t) return true;
    if (BAD_VALUES.some(b => t.includes(b))) return true;
    if (cached?.isWelcome && currentHealthKey) return true;
    if (cached?.v !== 8) return true;
    // If the insight was generated with different health data than what we have now, it's stale.
    // e.g. generated with yesterday's bleeding data, or generated before Oura loaded.
    if (cached?.healthKey !== undefined && cached.healthKey !== currentHealthKey) return true;
    return false;
  }

  async function generate(currentHealthKey) {
    if (!token || !userId) return;
    if (generatedWithKey.current === currentHealthKey) return; // already generated for this exact state
    generatedWithKey.current = currentHealthKey;
    clearTimeout(waitTimer.current);
    setBusy(true); setError(""); setIsFree(false);
    try {
      const cached = await dbLoad(date, "insights", token);
      const age = cached?.generatedAt ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
      if (cached?.text && !isBadCache(cached.text, cached, currentHealthKey) && age < 12 * 60 * 60 * 1000) {
        setText(cleanInsight(cached.text)); setBusy(false); return;
      }
      const res = await fetch("/api/insights", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ date, healthKey: currentHealthKey }),
      });
      const data = await res.json();
      if (data.tier === "free") { setIsFree(true); setFreeUsage({ count: data.usageCount, limit: data.limit }); }
      else if (data.insight) setText(cleanInsight(data.insight));
      else if (data.error) setError(data.error);
    } catch (e) { setError(e.message); }
    setBusy(false);
  }

  // Reset on date change
  useEffect(() => {
    if (prevDate.current === date) return;
    prevDate.current = date;
    generatedWithKey.current = null;
    clearTimeout(waitTimer.current);
    setText(""); setError(""); setIsFree(false); setFreeUsage(null);
  }, [date]); // eslint-disable-line

  // Trigger generation:
  // - If real health data is present: generate immediately with that key
  // - If no health data after 3s: generate with the empty key (no-ring day / future date)
  // - If health arrives AFTER the empty-key fallback fired: regenerate with real data
  useEffect(() => {
    if (!token || !userId) return;
    const [, sleep, readiness] = (healthKey || "::").split(":");
    const hasRealData = (+sleep > 0) || (+readiness > 0);
    if (hasRealData) {
      clearTimeout(waitTimer.current);
      generate(healthKey);
    } else {
      // Only start the timer if we haven't generated yet
      if (generatedWithKey.current !== null) return;
      clearTimeout(waitTimer.current);
      waitTimer.current = setTimeout(() => generate(healthKey), 3000);
    }
    return () => clearTimeout(waitTimer.current);
  }, [date, token, userId, healthKey]); // eslint-disable-line

  return (
    <Widget label="Insights" color={C.muted} slim collapsed={collapsed} onToggle={onToggle}>
      {/* Fixed responsive height — content scrolls inside, no scrollbar visible */}
      <div style={{ height: "clamp(80px, 10vh, 120px)", overflowY: "auto", scrollbarWidth: "none" }}>
        <div style={{ opacity: busy && !text ? 0 : 1, transition: "opacity 0.3s ease" }}>
          {error && (
            <div style={{ fontFamily: mono, fontSize:F.md, color: C.red, lineHeight: 1.6 }}>{error}</div>
          )}
          {isFree ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 13, color: C.muted, lineHeight: 1.6, marginBottom: 12 }}>
                You've used {freeUsage?.count ?? 10} of {freeUsage?.limit ?? 10} free AI insights.
              </div>
              <div style={{ fontFamily: mono, fontSize: 12, color: C.dim, lineHeight: 1.7, marginBottom: 14 }}>
                Upgrade to Premium for unlimited insights, voice entry, and chat with your health data.
              </div>
              <button onClick={() => window.location.href = "/upgrade"} style={{
                background: C.accent, border: "none", borderRadius: 6, padding: "8px 18px",
                cursor: "pointer", fontFamily: mono, fontSize: F.sm, color: C.bg,
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>Upgrade to Premium →</button>
            </div>
          ) : text ? (
            <div style={{ fontFamily: mono, fontSize:13, color: C.dim, lineHeight: 1.75, whiteSpace: "pre-line" }}>
              {text}
            </div>
          ) : busy ? (
            <div>
              <Shimmer width="90%" height={13} />
              <div style={{ height: 10 }} />
              <Shimmer width="72%" height={13} />
              <div style={{ height: 10 }} />
              <Shimmer width="50%" height={13} />
            </div>
          ) : null}
        </div>
      </div>
    </Widget>
  );
}

// ─── Chat / QuickAdd ──────────────────────────────────────────────────────────
// Collapsed: floating entry bar (quick commands, no history).
// Expanded: full-height panel with conversation history, Q&A + entry actions.

// ─── DayLabLoader ─────────────────────────────────────────────────────────────
