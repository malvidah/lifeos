"use client";
import { useState, useEffect, useRef, useCallback, Fragment } from "react";
import { serif, mono, F, R, blurweb } from "@/lib/tokens";
import { api } from "@/lib/api";
import { dbLoad, dbSave, MEM, DIRTY, pushHistory } from "@/lib/db";
import { DayLabLoader } from "../ui/primitives.jsx";

// ─── Chat / QuickAdd ──────────────────────────────────────────────────────────
// Floating entry bar (quick commands) + expandable sidebar with conversation history.

// ─── DL Sparkle icon (4-pointed star) ────────────────────────────────────────
function DLSparkle({ size = 14, color = "var(--dl-accent)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={color} style={{ flexShrink: 0 }}>
      <path d="M12 2L13.9 10.1L22 12L13.9 13.9L12 22L10.1 13.9L2 12L10.1 10.1Z"/>
    </svg>
  );
}

// ─── TTS speaker button for assistant messages ──────────────────────────────
function TTSButton({ text, token }) {
  const [state, setState] = useState('idle'); // idle | loading | playing
  const audioRef = useRef(null);

  const handleClick = useCallback(async () => {
    if (state === 'playing') {
      audioRef.current?.pause();
      audioRef.current = null;
      setState('idle');
      return;
    }
    if (state === 'loading') return;
    setState('loading');
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) { setState('idle'); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setState('idle'); audioRef.current = null; URL.revokeObjectURL(url); };
      audio.onerror = () => { setState('idle'); audioRef.current = null; URL.revokeObjectURL(url); };
      await audio.play();
      setState('playing');
    } catch {
      setState('idle');
    }
  }, [state, text, token]);

  return (
    <button onClick={handleClick} title={state === 'playing' ? 'Stop' : 'Listen'} style={{
      background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
      color: 'var(--dl-middle)', display: 'flex', alignItems: 'center',
      transition: 'color 0.15s', alignSelf: 'flex-start',
    }}
    onMouseEnter={e => e.currentTarget.style.color = 'var(--dl-strong)'}
    onMouseLeave={e => e.currentTarget.style.color = 'var(--dl-middle)'}>
      {state === 'loading' ? (
        <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid var(--dl-accent)', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
      ) : state === 'playing' ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        </svg>
      )}
    </button>
  );
}

export default function ChatFloat({date, token, userId, healthKey, theme, expanded, onExpandedChange, openTrigger, onChatOpenChange}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // ── Pill phase state machine ─────────────────────────────────────────────
  // idle → input → busy → result-change | result-info → idle
  const [pillPhase, setPillPhase] = useState('idle');
  const [resultText, setResultText] = useState('');
  const [resultExpanded, setResultExpanded] = useState(false); // "show more"
  const [busyText, setBusyText] = useState('Thinking\u2026');
  const [followUpText, setFollowUpText] = useState('');
  const undoFnRef = useRef(null);
  const aiResultsRef = useRef(null); // voice-action results with IDs for server-side undo
  const abortedRef = useRef(false);
  const pillRef = useRef(null);


  const [messages, setMessages] = useState([]); // [{role, content, actions, summary, isInsight}]
  const prevDate = useRef(date);

  const [chatQueryCount, setChatQueryCount] = useState(0);
  const [chatLimitReached, setChatLimitReached] = useState(false);
  const [isPremiumUser, setIsPremiumUser] = useState(false);
  const FREE_CHAT_LIMIT = 3;

  // Load chat query count + premium status from user_settings
  useEffect(() => {
    if (!token || !userId) return;
    // Read premium from user_settings (same source as server-side isPremium)
    fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        const settings = d?.data ?? {};
        setIsPremiumUser(settings.premium?.active === true);
        const count = settings.insightUsage?.count || 0;
        setChatQueryCount(count);
        if (count >= FREE_CHAT_LIMIT && !settings.premium?.active) setChatLimitReached(true);
      })
      .catch(() => {});
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
    const handler = (e) => { if (e.key === "Escape") onExpandedChange(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [expanded]);

  // Close input pill on click outside (not hover — keeps pill stable for button clicks)
  useEffect(() => {
    if (pillPhase !== 'input') return;
    function handleOutside(e) {
      if (pillRef.current && !pillRef.current.contains(e.target)) {
        setPillPhase('closing');
        setTimeout(() => setPillPhase('idle'), 120);
      }
    }
    // Use setTimeout so the click that opened the pill doesn't immediately close it
    const t = setTimeout(() => document.addEventListener('mousedown', handleOutside), 10);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', handleOutside); };
  }, [pillPhase]);

  // Open pill when Dashboard's AI button is clicked
  useEffect(() => {
    if (!openTrigger) return;
    setPillPhase('input');
    setTimeout(() => inputRef.current?.focus(), 120);
  }, [openTrigger]); // eslint-disable-line

  // Notify parent whether chat pill is open (so Dashboard can hide PageDots)
  useEffect(() => {
    onChatOpenChange?.(pillPhase !== 'idle');
  }, [pillPhase]); // eslint-disable-line

  // Reset messages on date change
  useEffect(() => {
    if (prevDate.current !== date) {
      prevDate.current = date;
      setMessages([]);
    }
  }, [date]);

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
      recordingCancelledRef.current = false; // reset for this new session
      recorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        // Capture cancelled state NOW — before any async work. A new recording
        // session may reset the ref before we check it otherwise.
        const wasCancelled = recordingCancelledRef.current;
        recordingCancelledRef.current = false;
        if (wasCancelled) { setListening(false); setTranscribing(false); return; }
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

  // Dispatch refresh after chat actions, with undo support. Returns undoFn or null.
  function dispatchRefresh(refreshTypes, summary) {
    if (!refreshTypes?.length) return null;
    const snapshots = {};
    refreshTypes.forEach(t => {
      const key = `${userId}:${date}:${t}`;
      if (MEM[key] !== undefined) snapshots[key] = JSON.parse(JSON.stringify(MEM[key]));
    });
    window.dispatchEvent(new CustomEvent("daylab:refresh", { detail: { types: refreshTypes } }));
    if (refreshTypes.includes('goals')) window.dispatchEvent(new Event('daylab:goals-changed'));
    let undoFn = null;
    if (Object.keys(snapshots).length > 0) {
      undoFn = () => {
        Object.entries(snapshots).forEach(([k, v]) => { MEM[k] = v; DIRTY[k] = true; });
        window.dispatchEvent(new CustomEvent("daylab:snapshot-restore", { detail: { keys: Object.keys(snapshots) } }));
      };
      pushHistory({
        label: `AI: ${summary || "entry"}`,
        undo: undoFn,
        redo: () => {
          Object.keys(snapshots).forEach(k => { delete MEM[k]; delete DIRTY[k]; });
          window.dispatchEvent(new CustomEvent("daylab:refresh", { detail: { types: refreshTypes } }));
    if (refreshTypes.includes('goals')) window.dispatchEvent(new Event('daylab:goals-changed'));
        },
      });
    }
    return undoFn;
  }

  // ── Collapsed mode: quick command via voice-action ──────────────────────
  function logToChat(userText, replyText) {
    setMessages(prev => [
      ...prev,
      { role: "user", content: userText },
      { role: "assistant", content: replyText },
    ]);
  }

  async function sendQuick(textOverride) {
    const userText = (textOverride ?? input).trim();
    if (!userText || busy) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setFollowUpText('');
    stopMic();
    setBusy(true);
    setBusyText('Thinking\u2026');
    setPillPhase('busy');
    setResultExpanded(false);
    abortedRef.current = false;
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const data = await api.post("/api/voice-action", { text: userText, date, tz }, token);
      if (abortedRef.current) return;
      if (data?.ok && data.results?.length > 0) {
        // AI made data changes → show accept/reject + highlight
        const undoFn = dispatchRefresh(data.results.map(r => r.type), data.summary);
        undoFnRef.current = undoFn;
        aiResultsRef.current = data.results;
        logToChat(userText, data.summary || "Done");
        setResultText(data.summary || "Done");
        window.dispatchEvent(new CustomEvent("daylab:ai-pending", { detail: { types: data.results.map(r => r.type) } }));
        setPillPhase('result-change');
      } else if (data.tier === "free") {
        logToChat(userText, "Voice entry requires Premium");
        setResultText("Voice entry requires Premium — upgrade to use AI entry.");
        setPillPhase('result-info');
      } else if (data.message) {
        // Informational answer, no data changes
        logToChat(userText, data.message);
        setResultText(data.message);
        setPillPhase('result-info');
      } else if (data.error) {
        logToChat(userText, data.error);
        setResultText(data.error);
        setPillPhase('result-info');
      } else {
        logToChat(userText, "Not sure what to add — try being more specific.");
        setResultText("Not sure what to add — try being more specific.");
        setPillPhase('result-info');
      }
    } catch (e) {
      if (!abortedRef.current) {
        logToChat(userText, "Something went wrong");
        setResultText("Something went wrong — please try again.");
        setPillPhase('result-info');
      }
    }
    setBusy(false);
  }

  function handleStop() {
    abortedRef.current = true;
    setBusy(false);
    setPillPhase('idle');
  }

  function handleAccept() {
    window.dispatchEvent(new CustomEvent("daylab:ai-resolved"));
    // Log acceptance in chat history
    setMessages(prev => [...prev, { role: "assistant", content: `✓ ${resultText || "Accepted"}`, isStatus: true }]);
    undoFnRef.current = null;
    aiResultsRef.current = null;
    setPillPhase('idle');
  }

  async function handleReject() {
    window.dispatchEvent(new CustomEvent("daylab:ai-resolved"));
    // Log rejection in chat history
    setMessages(prev => [...prev, { role: "assistant", content: `✕ Undone: ${resultText || "Rejected"}`, isStatus: true }]);
    // Server-side undo: delete/revert records via the undo API
    const results = aiResultsRef.current;
    if (results?.length) {
      aiResultsRef.current = null;
      try {
        await api.post("/api/voice-action/undo", { results }, token);
      } catch (_) {}
      // Refresh UI so components reload from server
      const types = [...new Set(results.map(r => r.type))];
      window.dispatchEvent(new CustomEvent("daylab:refresh", { detail: { types } }));
    }
    // Also run client-side MEM undo as fallback
    if (undoFnRef.current) {
      undoFnRef.current();
      undoFnRef.current = null;
    }
    setPillPhase('idle');
  }

  function dismissResult() {
    setPillPhase('idle');
    setResultText('');
  }

  // ── Expanded mode: uses voice-action for data entry, same accept/reject flow ──
  async function sendChat(override) {
    const userText = (override ?? input).trim();
    if (!userText || busy) return;
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
      // Try voice-action first — handles data entry commands with accept/reject
      const vaData = await api.post("/api/voice-action", { text: userText, date, tz }, token);

      if (vaData?.ok && vaData.results?.length > 0) {
        // Data change — show summary with accept/reject
        const undoFn = dispatchRefresh(vaData.results.map(r => r.type), vaData.summary);
        undoFnRef.current = undoFn;
        aiResultsRef.current = vaData.results;
        const summary = vaData.summary || "Done";
        setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: summary, actions: vaData.results, summary }));
        window.dispatchEvent(new CustomEvent("daylab:ai-pending", { detail: { types: vaData.results.map(r => r.type) } }));
        // Show accept/reject in pill too
        setResultText(summary);
        setPillPhase('result-change');
      } else if (vaData?.message) {
        // Voice-action returned informational/error — show as chat message
        setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: vaData.message }));
      } else if (vaData?.tier === "free") {
        setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: "Voice entry requires a Premium account." }));
      } else {
        // Voice-action couldn't handle it — fall back to chat API for questions
        const data = await api.post("/api/chat", {
          messages: nextMessages.map(m => ({ role: m.role, content: m.content })),
          date, tz,
        }, token);
        if (data?.error) {
          setMessages(prev => prev.slice(0, -1).concat({ role: "assistant", content: `Error: ${data.error}` }));
        } else {
          const assistantMsg = { role: "assistant", content: data.reply, actions: data.actions, summary: data.summary };
          setMessages(prev => prev.slice(0, -1).concat(assistantMsg));
          if (data.refreshTypes?.length) dispatchRefresh(data.refreshTypes, data.summary);
        }
      }

      // Track usage for free accounts
      if (!isPremiumUser) {
        const newCount = chatQueryCount + 1;
        setChatQueryCount(newCount);
        if (newCount >= FREE_CHAT_LIMIT) setChatLimitReached(true);
        dbSave("global", "chat_usage", { count: newCount }, token);
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
      {/* ── AI chat view — sidebar on desktop, fullscreen on mobile ── */}
      {expanded && (
        <div style={{
          position: "fixed", zIndex: 95,
          background: "var(--dl-bg)",
          display: "flex", flexDirection: "column",
          animation: "fadeIn 0.15s ease",
          // Desktop: left sidebar; Mobile: fullscreen
          ...(mobile ? {
            top: 0, left: 0, right: 0, bottom: 0,
          } : {
            top: "calc(env(safe-area-inset-top, 0px) + 84px)", left: 0, bottom: 0,
            width: 380,
            borderRight: "1px solid var(--dl-border)",
            boxShadow: "4px 0 24px color-mix(in srgb, var(--dl-strong) 8%, transparent)",
          }),
        }}>
          {/* Spacer: on mobile clears TopBar */}
          {mobile && <div style={{ flexShrink: 0, height: "calc(env(safe-area-inset-top, 0px) + 64px)" }}/>}

          {/* Header */}
          <div style={{
            flexShrink: 0,
            padding: mobile ? "16px 20px 24px" : "12px 16px 16px",
            display: "flex", flexDirection: mobile ? "column" : "row", alignItems: "center",
            gap: mobile ? 0 : 0,
            borderBottom: mobile ? "none" : "1px solid var(--dl-border)",
          }}>
            {mobile ? (
              /* Mobile: centered layout with chevron-down */
              <>
                <button onClick={() => onExpandedChange(false)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: "var(--dl-middle)", display: "flex", alignItems: "center", justifyContent: "center",
                  width: 36, height: 36, borderRadius: 8,
                  transition: "color 0.15s, background 0.15s", marginBottom: 12,
                }}
                onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-strong)"; e.currentTarget.style.background = "var(--dl-strong)0e"; }}
                onMouseLeave={e => { e.currentTarget.style.color = "var(--dl-middle)"; e.currentTarget.style.background = "transparent"; }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                  <DLSparkle size={14} />
                  <span style={{ fontFamily: mono, fontSize: F.sm, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dl-middle)" }}>Day Lab AI</span>
                  {isPremiumUser && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--dl-accent)", background: "var(--dl-accent)18", border: "1px solid var(--dl-accent)40", borderRadius: 4, padding: "2px 6px" }}>Premium</span>}
                </div>
                <span style={{ fontFamily: blurweb, fontSize: F.lg, color: "var(--dl-strong)", letterSpacing: "0.06em" }}>
                  {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                </span>
              </>
            ) : (
              /* Desktop sidebar: horizontal header row */
              <>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
                  <DLSparkle size={13} />
                  <span style={{ fontFamily: mono, fontSize: F.sm, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--dl-middle)" }}>Day Lab AI</span>
                  {isPremiumUser && <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--dl-accent)", background: "var(--dl-accent)18", border: "1px solid var(--dl-accent)40", borderRadius: 4, padding: "2px 6px" }}>Premium</span>}
                </div>
                <button onClick={() => onExpandedChange(false)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dl-middle)", display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: 6, transition: "color 0.15s, background 0.15s" }}
                  onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-strong)"; e.currentTarget.style.background = "var(--dl-strong)0e"; }}
                  onMouseLeave={e => { e.currentTarget.style.color = "var(--dl-middle)"; e.currentTarget.style.background = "transparent"; }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </>
            )}
          </div>

          {/* Messages scroll area */}
          <div style={{
            flex: 1, overflowY: "auto", position: "relative",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "0 10px",
            // Mobile: pad for floating pill; Desktop sidebar: no extra bottom pad (input is inside panel)
            paddingBottom: mobile ? "calc(52px + max(28px, env(safe-area-inset-bottom, 28px)) + 24px)" : "24px",
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
                <span style={{ fontFamily: mono, fontSize: 11, color: "var(--dl-highlight)", letterSpacing: "0.08em" }}>
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
                      background: msg.role === "user" ? "var(--dl-accent)" : "var(--dl-strong)0e",
                      color: msg.role === "user" ? "#fff" : "var(--dl-strong)",
                      fontFamily: msg.role === "user" ? serif : mono,
                      fontSize: msg.role === "user" ? F.md : 13,
                      lineHeight: 1.55,
                      letterSpacing: msg.role === "user" ? 0 : "0.02em",
                    }}>
                      {msg.content === null
                        ? <DayLabLoader size={28} color={"var(--dl-middle)"}/>
                        : msg.content}
                    </div>
                    {msg.actions?.length > 0 && msg.summary && (
                      <div style={{
                        fontSize: 11, fontFamily: mono, color: "var(--dl-green)",
                        background: "var(--dl-green)15", border: "1px solid var(--dl-green)30",
                        borderRadius: 12, padding: "3px 10px", letterSpacing: "0.04em",
                      }}>✓ {msg.summary}</div>
                    )}
                    {msg.role === "assistant" && msg.content && <TTSButton text={msg.content} token={token} />}
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

              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Desktop sidebar: input at bottom of panel */}
          {!mobile && (
            <div style={{ flexShrink: 0, borderTop: "1px solid var(--dl-border)", padding: "10px 12px", paddingBottom: "calc(10px + env(safe-area-inset-bottom, 0px))" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, background: "color-mix(in srgb, var(--dl-strong) 5%, transparent)", borderRadius: 100, padding: "8px 10px 8px 14px" }}>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px"; }}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  className="dl-chat-input"
                  placeholder={busy ? "Thinking…" : "Ask AI anything…"}
                  disabled={busy || (chatLimitReached && !isPremiumUser)}
                  rows={1}
                  style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: serif, fontSize: F.md, color: "var(--dl-strong)", padding: "0", margin: "0", opacity: (busy || (chatLimitReached && !isPremiumUser)) ? 0.4 : 1, lineHeight: 1.4, resize: "none", overflow: "hidden", maxHeight: "100px", display: "block" }}
                />
                {busy ? (
                  <div style={{ width: 12, height: 12, borderRadius: "50%", border: "1.5px solid var(--dl-accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                ) : input.trim() ? (
                  <button onClick={() => sendChat()} style={{ background: "var(--dl-accent)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                  </button>
                ) : hasMic ? (
                  <button onClick={transcribing ? undefined : toggleMic} style={{ background: transcribing ? "var(--dl-accent)22" : listening ? "var(--dl-red)22" : "transparent", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: transcribing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {transcribing ? <div style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px solid var(--dl-accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }}/> : listening ? <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--dl-red)", boxShadow: "0 0 0 3px var(--dl-red)30", animation: "pulse 1.2s ease-in-out infinite" }}/> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dl-highlight)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>}
                  </button>
                ) : null}
              </div>
            </div>
          )}

        </div>
      )}

      {/* ── Floating pill / card — hidden when desktop sidebar is open ── */}
      {(!expanded || mobile) && <div ref={pillRef} style={{
        position: "fixed",
        bottom: "env(safe-area-inset-bottom, 0px)",
        left: 0, right: 0,
        paddingLeft: 10, paddingRight: 10,
        paddingBottom: mobile ? "4px" : "8px",
        zIndex: 97,
        display: "flex", flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}>

        {/* Shared glass styles */}
        {(() => {
          const glass = {
            backdropFilter: "blur(20px) saturate(1.4)",
            WebkitBackdropFilter: "blur(20px) saturate(1.4)",
            background: "var(--dl-glass)",
            border: "1px solid var(--dl-glass-border)",
            boxShadow: "var(--dl-shadow)",
          };

          // ── EXPANDED MODE: solid input bar at bottom of full-panel ──────────
          if (expanded) {
            return (
              <div style={{
                width: "100%", maxWidth: 560, pointerEvents: "auto",
                display: "flex", alignItems: "center",
                background: "var(--dl-bg)", border: "1px solid var(--dl-border)",
                borderRadius: 100, minHeight: 52, overflow: "hidden",
                boxShadow: "var(--dl-shadow)",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: mobile ? "12px 10px 12px 16px" : "12px 10px 12px 18px", boxSizing: "border-box" }}>
                  <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 6 }}>
                    <textarea
                      ref={inputRef}
                      value={input}
                      onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                      onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                      className="dl-chat-input"
                      placeholder={busy ? "…" : "Ask AI anything…"}
                      disabled={busy || (chatLimitReached && !isPremiumUser)}
                      rows={1}
                      style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: serif, fontSize: F.md, color: "var(--dl-strong)", padding: "0", margin: "0", opacity: (busy || (chatLimitReached && !isPremiumUser)) ? 0.4 : 1, lineHeight: 1.4, resize: "none", overflow: "hidden", maxHeight: "120px", display: "block" }}
                    />
                    {input.trim() ? (
                      <button onClick={() => sendChat()} disabled={busy} style={{ background: "var(--dl-accent)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: busy ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, opacity: busy ? 0.4 : 1 }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                      </button>
                    ) : hasMic ? (
                      <button onClick={transcribing ? undefined : toggleMic} style={{ background: transcribing ? "var(--dl-accent)22" : listening ? "var(--dl-red)22" : "transparent", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: transcribing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "background 0.2s" }}>
                        {transcribing ? <div style={{ width: 10, height: 10, borderRadius: "50%", border: "1.5px solid var(--dl-accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }}/> : listening ? <div style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--dl-red)", boxShadow: "0 0 0 3px var(--dl-red)30", animation: "pulse 1.2s ease-in-out infinite" }}/> : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dl-highlight)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          }

          // ── IDLE: Dashboard owns the trigger button — render nothing ────────
          if (pillPhase === 'idle') {
            return null;
          }

          // ── CLOSING: fade out ──────────────────────────────────────────
          if (pillPhase === 'closing') {
            return null;
          }

          // ── INPUT: expanded pill with textarea (stays open until click outside) ──
          if (pillPhase === 'input') {
            return (
              <div style={{ width: "100%", maxWidth: 560, pointerEvents: "auto", display: "flex", alignItems: "center", borderRadius: 100, minHeight: 52, overflow: "hidden", ...glass }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", padding: mobile ? "12px 16px 12px 8px" : "12px 18px 12px 8px", boxSizing: "border-box" }}>
                  {/* Open full chat — left side */}
                  <button
                    onClick={() => { onExpandedChange(true); setPillPhase('idle'); }}
                    title="Open chat history"
                    style={{ background: "transparent", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--dl-middle)", transition: "color 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--dl-middle)"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                    </svg>
                  </button>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={e => { setInput(e.target.value); e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendQuick(); } }}
                    className="dl-chat-input"
                    placeholder="Ask AI anything…"
                    autoFocus
                    rows={1}
                    style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: serif, fontSize: F.md, color: "var(--dl-strong)", padding: "0", margin: "0", lineHeight: 1.4, resize: "none", overflow: "hidden", maxHeight: "120px", display: "block" }}
                  />
                  {/* Send or mic */}
                  {input.trim() ? (
                    <button onClick={() => sendQuick()} style={{ background: "var(--dl-accent)", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                    </button>
                  ) : hasMic ? (
                    <button onClick={transcribing ? undefined : toggleMic} style={{ background: transcribing ? "var(--dl-accent)22" : listening ? "var(--dl-red)22" : "transparent", border: "none", borderRadius: "50%", width: 30, height: 30, cursor: transcribing ? "default" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      {transcribing ? <div style={{ width: 9, height: 9, borderRadius: "50%", border: "1.5px solid var(--dl-accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }}/> : listening ? <div style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--dl-red)", boxShadow: "0 0 0 3px var(--dl-red)30", animation: "pulse 1.2s ease-in-out infinite" }}/> : <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--dl-highlight)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="11" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/></svg>}
                    </button>
                  ) : null}
                </div>
              </div>
            );
          }

          // ── BUSY: spinner + text + stop ───────────────────────────────────────
          if (pillPhase === 'busy') {
            return (
              <div style={{ width: "100%", maxWidth: 560, pointerEvents: "auto", display: "flex", alignItems: "center", borderRadius: 100, minHeight: 52, overflow: "hidden", animation: "fadeIn 0.12s ease", ...glass }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "14px 14px 14px 18px", boxSizing: "border-box" }}>
                  <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1.5px solid var(--dl-accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
                  <span style={{ flex: 1, fontFamily: serif, fontSize: F.md, color: "var(--dl-middle)", lineHeight: 1.4 }}>{busyText}</span>
                  <button onClick={handleStop} title="Stop" style={{ background: "color-mix(in srgb, var(--dl-strong) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--dl-strong) 12%, transparent)", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--dl-middle)" }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                  </button>
                </div>
              </div>
            );
          }

          // ── Shared follow-up input row (used in result states) ────────────────
          const followUpRow = (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 16px 12px 12px", boxSizing: "border-box" }}>
              <button onClick={() => { onExpandedChange(true); setPillPhase('idle'); }} title="Open full chat" style={{ background: "transparent", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, color: "var(--dl-middle)" }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
              <input
                value={followUpText}
                onChange={e => setFollowUpText(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && followUpText.trim()) { sendQuick(followUpText); setFollowUpText(''); } }}
                placeholder="Ask a follow-up…"
                style={{ flex: 1, background: "transparent", border: "none", outline: "none", fontFamily: serif, fontSize: F.sm, color: "var(--dl-strong)", lineHeight: 1.4 }}
              />
              {followUpText.trim() && (
                <button onClick={() => { sendQuick(followUpText); setFollowUpText(''); }} style={{ background: "var(--dl-accent)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>
                </button>
              )}
            </div>
          );

          // ── RESULT-CHANGE: summary + accept/reject + follow-up ────────────────
          if (pillPhase === 'result-change') {
            const PREVIEW = 160;
            const isLong = resultText.length > PREVIEW;
            const shown = isLong && !resultExpanded ? resultText.slice(0, PREVIEW) + '…' : resultText;
            return (
              <div style={{ width: "100%", maxWidth: 560, pointerEvents: "auto", display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", animation: "fadeInUp 0.15s ease", ...glass }}>
                {/* Top: sparkle + response + accept/reject */}
                <div style={{ padding: "14px 14px 10px 16px" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
                    <DLSparkle size={14} color="var(--dl-accent)" />
                    <div style={{ flex: 1 }}>
                      <span style={{ fontFamily: serif, fontSize: F.md, color: "var(--dl-strong)", lineHeight: 1.5 }}>{shown}</span>
                      {isLong && (
                        <button onClick={() => setResultExpanded(p => !p)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, color: "var(--dl-accent)", letterSpacing: "0.06em", padding: "0 0 0 6px" }}>
                          {resultExpanded ? 'show less' : 'show more'}
                        </button>
                      )}
                    </div>
                  </div>
                  {/* Accept / Reject — icon buttons */}
                  <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button onClick={handleReject} title="Undo" style={{ background: "color-mix(in srgb, var(--dl-strong) 8%, transparent)", border: "1px solid color-mix(in srgb, var(--dl-strong) 12%, transparent)", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dl-middle)", transition: "color 0.15s, background 0.15s" }}
                      onMouseEnter={e => { e.currentTarget.style.color = "var(--dl-red, #c44)"; e.currentTarget.style.background = "color-mix(in srgb, var(--dl-red, #c44) 10%, transparent)"; }}
                      onMouseLeave={e => { e.currentTarget.style.color = "var(--dl-middle)"; e.currentTarget.style.background = "color-mix(in srgb, var(--dl-strong) 8%, transparent)"; }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                    </button>
                    <button onClick={handleAccept} title="Accept" style={{ background: "var(--dl-accent)", border: "none", borderRadius: "50%", width: 28, height: 28, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "opacity 0.15s" }}
                      onMouseEnter={e => e.currentTarget.style.opacity = "0.85"}
                      onMouseLeave={e => e.currentTarget.style.opacity = "1"}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    </button>
                  </div>
                </div>
                {/* Divider */}
                <div style={{ height: 1, background: "color-mix(in srgb, var(--dl-strong) 10%, transparent)", margin: "0 2px" }} />
                {/* Follow-up */}
                {followUpRow}
              </div>
            );
          }

          // ── RESULT-INFO: informational response + follow-up ───────────────────
          if (pillPhase === 'result-info') {
            const PREVIEW = 220;
            const isLong = resultText.length > PREVIEW;
            const shown = isLong && !resultExpanded ? resultText.slice(0, PREVIEW) + '…' : resultText;
            return (
              <div style={{ width: "100%", maxWidth: 560, pointerEvents: "auto", display: "flex", flexDirection: "column", borderRadius: 20, overflow: "hidden", animation: "fadeInUp 0.15s ease", ...glass }}>
                {/* Top bar: sparkle + close */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 12px 6px 16px" }}>
                  <DLSparkle size={14} color="var(--dl-accent)" />
                  <button onClick={dismissResult} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--dl-middle)", display: "flex", alignItems: "center", justifyContent: "center", width: 26, height: 26, borderRadius: "50%", transition: "color 0.15s" }}
                    onMouseEnter={e => e.currentTarget.style.color = "var(--dl-strong)"}
                    onMouseLeave={e => e.currentTarget.style.color = "var(--dl-middle)"}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                {/* Scrollable response */}
                <div style={{ padding: "0 16px 12px", maxHeight: 220, overflowY: "auto", scrollbarWidth: "none" }}>
                  <span style={{ fontFamily: serif, fontSize: F.md, color: "var(--dl-strong)", lineHeight: 1.55, display: "block" }}>{shown}</span>
                  {isLong && (
                    <button onClick={() => setResultExpanded(p => !p)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, color: "var(--dl-accent)", letterSpacing: "0.06em", padding: "4px 0 0", display: "block" }}>
                      {resultExpanded ? 'show less' : 'show more'}
                    </button>
                  )}
                </div>
                {/* Divider */}
                <div style={{ height: 1, background: "color-mix(in srgb, var(--dl-strong) 10%, transparent)", margin: "0 2px" }} />
                {/* Follow-up */}
                {followUpRow}
              </div>
            );
          }

          return null;
        })()}
      </div>}
    </>
  )}


// ─── Widget definitions ───────────────────────────────────────────────────────

// ─── SearchBar ────────────────────────────────────────────────────────────────
// ─── useSearch: debounced live search across all entry types ─────────────────
