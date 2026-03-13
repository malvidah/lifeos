"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { serif, mono, F, R, blurweb } from "@/lib/tokens";
import { toKey, todayKey, fmtDate } from "@/lib/dates";
import { api } from "@/lib/api";
import { dbLoad, dbSave, MEM, DIRTY, pushHistory } from "@/lib/db";
import { useIsMobile } from "@/lib/hooks";
import { DayLabLoader, Card, Shimmer } from "../ui/primitives.jsx";

export function InsightsCard({date, token, userId, healthKey, collapsed, onToggle}) {
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
      const data = await api.post("/api/insights", { date, healthKey: currentHealthKey }, token);
      if (data?.tier === "free") { setIsFree(true); setFreeUsage({ count: data.usageCount, limit: data.limit }); }
      else if (data?.insight) setText(cleanInsight(data.insight));
      else if (data?.error) setError(data.error);
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
    <Card label="Insights" color={"var(--dl-detail)"} slim collapsed={collapsed} onToggle={onToggle}>
      {/* Fixed responsive height — content scrolls inside, no scrollbar visible */}
      <div style={{ height: "clamp(80px, 10vh, 120px)", overflowY: "auto", scrollbarWidth: "none" }}>
        <div style={{ opacity: busy && !text ? 0 : 1, transition: "opacity 0.3s ease" }}>
          {error && (
            <div style={{ fontFamily: mono, fontSize:F.md, color: "var(--dl-red)", lineHeight: 1.6 }}>{error}</div>
          )}
          {isFree ? (
            <div>
              <div style={{ fontFamily: mono, fontSize: 13, color: "var(--dl-detail)", lineHeight: 1.6, marginBottom: 12 }}>
                You've used {freeUsage?.count ?? 10} of {freeUsage?.limit ?? 10} free AI insights.
              </div>
              <div style={{ fontFamily: mono, fontSize: 12, color: "var(--dl-muted)", lineHeight: 1.7, marginBottom: 14 }}>
                Upgrade to Premium for unlimited insights, voice entry, and chat with your health data.
              </div>
              <button onClick={() => window.location.href = "/upgrade"} style={{
                background: "var(--dl-accent)", border: "none", borderRadius: 6, padding: "8px 18px",
                cursor: "pointer", fontFamily: mono, fontSize: F.sm, color: "var(--dl-bg)",
                letterSpacing: "0.08em", textTransform: "uppercase",
              }}>Upgrade to Premium →</button>
            </div>
          ) : text ? (
            <div style={{ fontFamily: mono, fontSize:13, color: "var(--dl-muted)", lineHeight: 1.75, whiteSpace: "pre-line" }}>
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
    </Card>
  );
}

// ─── Chat / QuickAdd ──────────────────────────────────────────────────────────
// Collapsed: floating entry bar (quick commands, no history).
// Expanded: full-height panel with conversation history, Q&A + entry actions.

// ─── DayLabLoader ─────────────────────────────────────────────────────────────
export default function ChatFloat({date, token, userId, healthKey, theme}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);


  const [messages, setMessages] = useState([]); // [{role, content, actions, summary, isInsight}]
  const [insightLoading, setInsightLoading] = useState(false);
  const generatedInsightKey = useRef(null); // "date:healthKey" — prevents double-generation
  const prevDate = useRef(date);

  const [chatQueryCount, setChatQueryCount] = useState(0);
  const [chatLimitReached, setChatLimitReached] = useState(false);
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const FREE_CHAT_LIMIT = 3;

  // Load chat query count + premium status from DB
  useEffect(() => {
    if (!token || !userId) return;
    Promise.all([
      dbLoad("global", "chat_usage", token),
      dbLoad("global", "premium", token),
    ]).then(([usage, prem]) => {
      const count = usage?.count || 0;
      setChatQueryCount(count);
      if (count >= FREE_CHAT_LIMIT) setChatLimitReached(true);
      setIsPremiumUser(prem?.active === true);
    });
  }, [token, userId]); // eslint-disable-line

  const [listening, setListening] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;
  const recognizerRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const recordingCancelledRef = useRef(false);
  const inputRef = useRef(null);

  const messagesEndRef = useRef(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
    el.scrollTop = el.scrollHeight;
  }, [input]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    if (expanded && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, expanded]);

  // Close panel on Escape
  useEffect(() => {
    if (!expanded) return;
    const handler = (e) => { if (e.key === "Escape") setExpanded(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded]);

  // ── Insight generation — seeded as messages[0] ──────────────────────────
  useEffect(() => {
    if (!token || !userId) return;
    // Reset on date change
    if (prevDate.current !== date) {
      prevDate.current = date;
      generatedInsightKey.current = null;
      setMessages([]);
    }
    const [, sleep, readiness] = (healthKey || "::").split(":");
    const hasRealData = (+sleep > 0) || (+readiness > 0);
    const key = `${date}:${healthKey}`;
    if (generatedInsightKey.current === key) return;

    // Wait for real data; if none after 3s, proceed with whatever we have
    const run = async () => {
      if (generatedInsightKey.current === key) return;
      generatedInsightKey.current = key;
      setInsightLoading(true);
      try {
        // Check cache first
        const cached = await dbLoad(date, "insights", token);
        const age = cached?.generatedAt ? Date.now() - new Date(cached.generatedAt).getTime() : Infinity;
        const stale = !cached?.text || cached?.v !== 8 || age > 12 * 60 * 60 * 1000 ||
          (cached?.healthKey !== undefined && cached.healthKey !== healthKey);
        let text = null;
        if (!stale) {
          text = cached.text;
        } else {
          const data = await api.post("/api/insights", { date, healthKey }, token);
          if (data?.insight) text = data.insight;
          else if (data?.tier === "free") text = "Upgrade to Premium to unlock daily AI insights, voice entry, and chat.";
        }
        if (text) {
          const clean = text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
            .replace(/^#{1,3}\s+/gm, '').replace(/^[A-Za-z]+,\s+\w+ \d+\n+/, '').trim();
          setMessages(prev => {
            // Replace existing insight (first message if isInsight) or prepend
            const withoutInsight = prev.filter(m => !m.isInsight);
            return [{ role: "assistant", content: clean, isInsight: true }, ...withoutInsight];
          });
        }
      } catch (_) {}
      setInsightLoading(false);
    };

    if (hasRealData) {
      run();
    } else {
      const t = setTimeout(run, 3000);
      return () => clearTimeout(t);
    }
  }, [date, token, userId, healthKey]); // eslint-disable-line

  function logMicError(text) {
    setMessages(prev => [...prev, { role: "assistant", content: text }]);
  }

  async function recordAndTranscribe() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (recordingCancelledRef.current) { recordingCancelledRef.current = false; setListening(false); setTranscribing(false); return; }
        setListening(false);
        setTranscribing(true);
        try {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          const base64 = await new Promise((res) => {
            const reader = new FileReader();
            reader.onload = () => res(reader.result.split(",")[1]);
            reader.readAsDataURL(blob);
          });
          const data = await api.post("/api/transcribe", { audio: base64, mimeType }, token);
          if (data?.text) setInput(prev => prev ? prev + " " + data.text : data.text);
          else logMicError(data?.error || "Could not transcribe");
        } catch (e) { logMicError("Transcription failed"); }
        setTranscribing(false);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setListening(true);
    } catch (e) { logMicError("Microphone access denied"); }
  }

  function toggleMic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
      return;
    }
    if (recognizerRef.current && listening) {
      recognizerRef.current.stop();
      setListening(false);
      return;
    }
    if (!SR) {
      if (window.daylabNative) { logMicError("Voice not supported in this browser"); return; }
      recordAndTranscribe();
      return;
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    recognizerRef.current = rec;
    let finalTranscript = "";
    rec.onstart = () => { setListening(true); };
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTranscript += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      setInput(finalTranscript + interim);
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed") { logMicError("Microphone access denied"); setListening(false); }
      else if (e.error === "network") { setListening(false); if (!window.daylabNative) recordAndTranscribe(); }
      else if (e.error !== "no-speech" && e.error !== "aborted") { logMicError(`Mic error: ${e.error}`); setListening(false); }
      else { setListening(false); }
    };
    rec.onend = () => { setListening(false); };
    rec.start();
  }

  function stopMic() {
    if (mediaRecorderRef.current?.state === "recording") {
      recordingCancelledRef.current = true;
      mediaRecorderRef.current.stop();
    }
    if (recognizerRef.current) { recognizerRef.current.stop(); }
    setListening(false);
    setTranscribing(false);
  }

  // Dispatch refresh after chat actions, with undo support
  function dispatchRefresh(refreshTypes, summary) {
    if (!refreshTypes?.length) return;
    const snapshots = {};
    refreshTypes.forEach(t => {
      const key = `${userId}:${date}:${t}`;
      if (MEM[key] !== undefined) snapshots[key] = JSON.parse(JSON.stringify(MEM[key]));
    });
    window.dispatchEvent(new CustomEvent("daylab:refresh", { detail: { types: refreshTypes } }));
    if (Object.keys(snapshots).length > 0) {
      pushHistory({
        label: `AI: ${summary || "entry"}`,
        undo: () => {
          Object.entries(snapshots).forEach(([k, v]) => { MEM[k] = v; DIRTY[k] = true; });
          window.dispatchEvent(new CustomEvent("daylab:snapshot-restore", { detail: { keys: Object.keys(snapshots) } }));
        },
        redo: () => {
          Object.keys(snapshots).forEach(k => { delete MEM[k]; delete DIRTY[k]; });
          window.dispatchEvent(new CustomEvent("daylab:refresh", { detail: { types: refreshTypes } }));
        },
      });
    }
  }

  // ── Collapsed mode: quick command via voice-action ──────────────────────
  function logToChat(userText, replyText) {
    setMessages(prev => [
      ...prev,
      { role: "user", content: userText },
      { role: "assistant", content: replyText },
    ]);
  }

  async function sendQuick() {
    if (!input.trim() || busy) return;
    const userText = input.trim();
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    stopMic();
    setBusy(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await api.post("/api/voice-action", { text: userText, date, tz }, token);
      if (data?.ok && data.results?.length > 0) {
        dispatchRefresh(data.results.map(r => r.type), data.summary);
        logToChat(userText, data.summary || "Done");
      } else if (data.tier === "free") {
        logToChat(userText, "Voice entry requires Premium");
      } else if (data.message) {
        logToChat(userText, data.message);
      } else if (data.error) {
        logToChat(userText, data.error);
      } else {
        logToChat(userText, "Not sure what to add — try being more specific");
      }
    } catch (e) { logToChat(userText, "Something went wrong"); }
    setBusy(false);
  }

  // ── Expanded mode: conversational chat ───────────────────────────────────
  async function sendChat(override) {
    const userText = (override ?? input).trim();
    if (!userText || busy) return;
    // Free tier gate — check isPremium via response or local count
    if (chatLimitReached) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    stopMic();

    const userMsg = { role: "user", content: userText };
    const nextMessages = [...messages, userMsg];
    setMessages([...nextMessages, { role: "assistant", content: null }]); // null = loading
    setBusy(true);

    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await api.post("/api/chat", {
        messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
        date,
        tz,
      }, token);
      if (data?.error) {
        setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: `Error: ${data.error}` }));
      } else {
        const assistantMsg = { role: "assistant", content: data.reply, actions: data.actions, summary: data.summary };
        setMessages(prev => prev.slice(0, -1).concat(assistantMsg));
        if (data.refreshTypes?.length) dispatchRefresh(data.refreshTypes, data.summary);
        // Track usage for free accounts
        if (!data.isPremium && !isPremiumUser) {
          const newCount = chatQueryCount + 1;
          setChatQueryCount(newCount);
          if (newCount >= FREE_CHAT_LIMIT) setChatLimitReached(true);
          dbSave("global", "chat_usage", { count: newCount }, token);
        }
      }
    } catch (e) {
      setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: "Something went wrong. Try again." }));
    }
    setBusy(false);
  }

  function send() {
    if (expanded) sendChat();
    else sendQuick();
  }

  const hasMic = !!(window?.SpeechRecognition || window?.webkitSpeechRecognition || navigator?.mediaDevices?.getUserMedia);
  return (
    <>
      {/* ── AI chat view — sits below TopBar (zIndex 95), pill floats above at 97 ── */}
      {expanded && (
        <div style={{
          position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
          zIndex: 95,
          background: "var(--dl-bg)",
          display: "flex", flexDirection: "column",
          animation: "fadeIn 0.15s ease",
        }}>
          {/* Spacer to clear the TopBar (safe-area + 10px padding + 52px pill + 10px padding) */}
          <div style={{ flexShrink: 0, height: "calc(env(safe-area-inset-top, 0px) + 64px)" }}/>

          {/* AI header — chevron down to collapse, title, date */}
          <div style={{
            flexShrink: 0,
            padding: "16px 20px 24px",
            display: "flex", flexDirection: "column", alignItems: "center", gap: 0,
          }}>
            {/* Chevron down — collapse */}
            <button onClick={() => setExpanded(false)} style={{
              background: "none", border: "none", cursor: "pointer",
              color: "var(--dl-muted)", display: "flex", alignItems: "center", justifyContent: "center",
              width: 36, height: 36, borderRadius: 8,
              transition: "color 0.15s, background 0.15s",
              marginBottom: 12,
            }}
            onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-middle)"; e.currentTarget.style.background = "var(--dl-middle)0e"; }}
            onMouseLeave={e => { e.currentTarget.style.color = "var(--dl-muted)"; e.currentTarget.style.background = "transparent"; }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>

            {/* DAY LAB AI + Premium badge */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ fontFamily: mono, fontSize: F.sm, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dl-muted)" }}>
                Day Lab AI
              </span>
              {isPremiumUser && (
                <span style={{
                  fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase",
                  color: "var(--dl-accent)", background: "var(--dl-accent)18", border: "1px solid var(--dl-accent)40",
                  borderRadius: 4, padding: "2px 6px",
                }}>Premium</span>
              )}
            </div>

            {/* Date */}
            <span style={{ fontFamily: blurweb, fontSize: F.lg, color: "var(--dl-middle)", letterSpacing: "0.06em" }}>
              {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            </span>
          </div>

          {/* Messages scroll area */}
          <div style={{
            flex: 1, overflowY: "auto", position: "relative",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "0 10px",
            paddingBottom: "calc(52px + max(28px, env(safe-area-inset-bottom, 28px)) + 24px)",
          }}>
            {/* Free tier vignette — sticky top overlay as limit approaches */}
            {!isPremiumUser && (chatQueryCount >= FREE_CHAT_LIMIT - 1 || chatLimitReached) && (
              <div style={{
                position: "sticky", top: 0, zIndex: 10, width: "100%",
                background: "linear-gradient(to bottom, var(--dl-bg) 30%, var(--dl-bg)cc 70%, transparent 100%)",
                padding: "14px 16px 44px", marginBottom: -32,
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8,
                pointerEvents: chatLimitReached ? "auto" : "none",
              }}>
                <span style={{ fontFamily: mono, fontSize: 11, color: "var(--dl-detail)", letterSpacing: "0.08em" }}>
                  {chatLimitReached
                    ? `${FREE_CHAT_LIMIT}/${FREE_CHAT_LIMIT} FREE MESSAGES USED`
                    : `${chatQueryCount}/${FREE_CHAT_LIMIT} free messages`}
                </span>
                {chatLimitReached && (
                  <button onClick={() => window.location.href = "/upgrade"} style={{
                    background: "var(--dl-accent)", border: "none", borderRadius: 10,
                    padding: "9px 22px", cursor: "pointer",
                    fontFamily: mono, fontSize: 11, color: "#fff",
                    letterSpacing: "0.08em", textTransform: "uppercase",
                  }}>Upgrade to Premium →</button>
                )}
              </div>
            )}
            <div style={{
              width: "100%", maxWidth: 720,
              display: "flex", flexDirection: "column", gap: 12, paddingTop: 8,
            }}>

              {/* Message bubbles */}
              {messages.map((msg, i) => (
                <Fragment key={i}>
                  <div style={{
                    display: "flex", flexDirection: "column",
                    alignItems: msg.role === "user" ? "flex-end" : "flex-start",
                    gap: 4,
                  }}>
                    <div style={{
                      maxWidth: "72%",
                      padding: "10px 16px",
                      borderRadius: msg.role === "user" ? "18px 18px 4px 18px" : "18px 18px 18px 4px",
                      background: msg.role === "user" ? "var(--dl-accent)" : "var(--dl-middle)0e",
                      color: msg.role === "user" ? "#fff" : "var(--dl-middle)",
                      fontFamily: msg.role === "user" ? serif : mono,
                      fontSize: msg.role === "user" ? F.md : 13,
                      lineHeight: 1.55,
                      letterSpacing: msg.role === "user" ? 0 : "0.02em",
                    }}>
                      {msg.content === null
                        ? <DayLabLoader size={28} color={"var(--dl-muted)"}/>
                        : msg.content}
                    </div>
                    {msg.actions?.length > 0 && msg.summary && (
                      <div style={{
                        fontSize: 11, fontFamily: mono, color: "var(--dl-green)",
                        background: "var(--dl-green)15", border: "1px solid var(--dl-green)30",
                        borderRadius: 12, padding: "3px 10px", letterSpacing: "0.04em",
                      }}>✓ {msg.summary}</div>
                    )}
                  </div>

                  {/* Chips inline after insight, before any user msg */}
                  {msg.isInsight && messages.filter(m => m.role === "user").length === 0 && (
                    <div style={{
                      display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 8,
                      marginTop: 16, maxWidth: 560,
                    }}>
                      {["How's my sleep this week?", "Add oatmeal for breakfast", "What tasks are left today?", "Log a 30 min run"].map(s => (
                        <button key={s} onClick={() => sendChat(s)}
                          style={{
                            background: "var(--dl-accent)12", border: "1px solid var(--dl-accent)30",
                            borderRadius: 100, padding: "10px 20px",
                            fontFamily: mono, fontSize: F.sm, color: "var(--dl-accent)",
                            cursor: "pointer", letterSpacing: "0.04em",
                            whiteSpace: "nowrap",
                            transition: "background 0.15s, border-color 0.15s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "var(--dl-accent)22"; e.currentTarget.style.borderColor = "var(--dl-accent)55"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "var(--dl-accent)12"; e.currentTarget.style.borderColor = "var(--dl-accent)30"; }}
                        >{s}</button>
                      ))}
                    </div>
                  )}
                </Fragment>
              ))}

              {insightLoading && messages.length === 0 && (
                <div style={{ padding: "8px 2px" }}>
                  <DayLabLoader size={32} color={"var(--dl-muted)"}/>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          </div>

        </div>
      )}

      {/* ── Floating pill — ALWAYS same capsule shape, fixed at bottom ── */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0,
        zIndex: 97,
        display: "flex", flexDirection: "column", alignItems: "center",
        paddingLeft: 10, paddingRight: 10,
        paddingBottom: mobile ? "env(safe-area-inset-bottom, 6px)" : "16px",
        pointerEvents: "none",
      }}>
        <div style={{
          width: "100%", maxWidth: 560,
          pointerEvents: "auto",
          display: "flex", flexDirection: "row", alignItems: "center",
          backdropFilter: expanded ? "none" : "blur(20px) saturate(1.4)",
          WebkitBackdropFilter: expanded ? "none" : "blur(20px) saturate(1.4)",
          background: expanded ? "var(--dl-surface)" : "var(--dl-surface)ee",
          border: "1px solid var(--dl-border)",
          borderRadius: 100,
          minHeight: 52,
          boxShadow: "var(--dl-shadow)",
          overflow: "hidden",
          cursor: !expanded ? "pointer" : "default",
          transition: "box-shadow 0.18s ease",
        }}
        onClick={!expanded ? () => inputRef.current?.focus() : undefined}>

          {/* ── Input row ── */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            width: "100%",
            padding: mobile ? "14px 10px 14px 16px" : "14px 10px 14px 18px",
            boxSizing: "border-box",
          }}>
            {/* Text input well */}
            <div style={{
              flex: 1,
              background: "transparent",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                onFocus={() => { if (!expanded) setExpanded(true); }}
                placeholder={busy ? "…" : "Ask AI anything…"}
                disabled={busy || (expanded && chatLimitReached && !isPremiumUser)}
                rows={1}
                style={{
                  flex: 1, background: "transparent", border: "none", outline: "none",
                  fontFamily: serif, fontSize: F.md, color: "var(--dl-middle)",
                  padding: "0", margin: "0", opacity: (busy || (expanded && chatLimitReached && !isPremiumUser)) ? 0.4 : 1,
                  lineHeight: 1.4, resize: "none", overflow: "hidden", maxHeight: "120px",
                  display: "block",
                }}
              />

              {/* Send or mic */}
              {input.trim() ? (
                <button onClick={send} disabled={busy} style={{
                  background: "var(--dl-accent)", border: "none", borderRadius: "50%",
                  width: 32, height: 32, cursor: busy ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, opacity: busy ? 0.4 : 1, transition: "opacity 0.15s",
                }}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"/>
                    <polyline points="5 12 12 5 19 12"/>
                  </svg>
                </button>
              ) : hasMic ? (
                <button onClick={transcribing ? undefined : toggleMic} style={{
                  background: transcribing ? "var(--dl-accent)22" : listening ? "var(--dl-red)22" : "transparent",
                  border: "none", borderRadius: "50%",
                  width: 32, height: 32, cursor: transcribing ? "default" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0, transition: "background 0.2s",
                }}>
                  {transcribing ? (
                    <div style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid var(--dl-accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }}/>
                  ) : listening ? (
                    <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--dl-red)", boxShadow: "0 0 0 3px var(--dl-red)30", animation: "pulse 1.2s ease-in-out infinite" }}/>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={"var(--dl-detail)"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="9" y="2" width="6" height="11" rx="3"/>
                      <path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/>
                    </svg>
                  )}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </>
  )}


// ─── Widget definitions ───────────────────────────────────────────────────────

// ─── SearchBar ────────────────────────────────────────────────────────────────
// ─── useSearch: debounced live search across all entry types ─────────────────
