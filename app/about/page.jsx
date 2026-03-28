"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { mono, F } from "@/lib/tokens";

const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });

const SECTION_LABEL = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 8 };
const STATUS_COLORS = { new: '#E8917A', read: '#6BAED6', resolved: '#5BA89D' };

const LAYER_CARD = {
  background: 'var(--dl-card)',
  border: '1px solid var(--dl-border)',
  borderRadius: 14, padding: '16px 18px',
  boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
};
const LAYER_TITLE = (color) => ({
  fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em',
  textTransform: 'uppercase', color, marginBottom: 6,
});
const LAYER_DESC = {
  fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)', lineHeight: '1.7',
};
const ARROW_STYLE = {
  fontFamily: mono, fontSize: 18, color: 'var(--dl-border2)',
  textAlign: 'center', padding: '2px 0', lineHeight: 1,
};
const BODY_TEXT = {
  fontFamily: mono, fontSize: 12, color: 'var(--dl-middle)', lineHeight: 1.85, letterSpacing: '0.01em',
};

// ── Connected services data ──────────────────────────────────────────────────
const CONNECTED_SERVICES = [
  { emoji: '\uD83D\uDDC4\uFE0F', name: 'Database', provider: 'Supabase', color: '#3ECF8E',
    desc: 'Stores all your data \u2014 journal, tasks, meals, health, goals, habits',
    techDetail: 'PostgreSQL with Row Level Security, real-time subscriptions',
    dashboard: 'https://supabase.com/dashboard' },
  { emoji: '\uD83E\uDDE0', name: 'AI', provider: 'Anthropic Claude', color: '#D4A574',
    desc: 'Powers the chat assistant, daily insights, and voice commands',
    techDetail: 'Claude Sonnet, streaming completions, tool-use for data queries',
    dashboard: 'https://console.anthropic.com/settings/billing' },
  { emoji: '\uD83C\uDF99\uFE0F', name: 'Voice', provider: 'Groq Whisper', color: '#F55036',
    desc: 'Converts your voice recordings into text',
    techDetail: 'Whisper Large v3, <1s latency via Groq inference',
    dashboard: 'https://console.groq.com/settings/billing' },
  { emoji: '\uD83D\uDD0A', name: 'Speech', provider: 'OpenAI TTS', color: '#74AA9C',
    desc: 'Reads AI responses back to you',
    techDetail: 'TTS-1 model, alloy voice, streaming audio',
    dashboard: 'https://platform.openai.com/settings/organization/billing/overview' },
  { emoji: '\uD83D\uDCC5', name: 'Calendar', provider: 'Google Calendar', color: '#4285F4',
    desc: 'Syncs events with your Google Calendar',
    techDetail: 'OAuth2, CalendarList + Events API, incremental sync',
    dashboard: 'https://console.cloud.google.com/billing' },
];

// ── Data categories ──────────────────────────────────────────────────────────
const DATA_CATEGORIES = [
  { emoji: '\u270D\uFE0F', label: 'Your Writing', desc: 'Journal entries, notes',
    tables: 'entries, notes', techDetail: 'Rich text via Tiptap, auto-saved' },
  { emoji: '\u2705', label: 'Your Tasks & Goals', desc: 'Tasks, goals, habits, completions',
    tables: 'tasks, goals, habits, habit_logs', techDetail: 'Row-level CRUD, drag reorder' },
  { emoji: '\uD83D\uDCAA', label: 'Your Health', desc: 'Sleep, HRV, steps, scores, workouts',
    tables: 'health_scores, workouts', techDetail: 'Strava + Apple Health sync' },
  { emoji: '\uD83C\uDF7D\uFE0F', label: 'Your Food', desc: 'Meals with nutrition estimates',
    tables: 'meals', techDetail: 'AI-powered nutrition parsing' },
  { emoji: '\uD83D\uDCCD', label: 'Your Places', desc: 'Locations and places visited',
    tables: 'places, location_logs', techDetail: 'Leaflet maps, reverse geocoding' },
  { emoji: '\uD83D\uDCC6', label: 'Your Calendar', desc: 'Events synced from Google',
    tables: 'calendar_events', techDetail: 'OAuth2 incremental sync' },
  { emoji: '\u2699\uFE0F', label: 'Your Settings', desc: 'Theme, preferences, premium status',
    tables: 'settings, premium_status', techDetail: 'Stripe billing integration' },
];

// ── Score definitions ────────────────────────────────────────────────────────
const SCORES = [
  { name: 'Sleep', desc: 'Combines Oura sleep score (if connected) with Apple Health sleep duration. Oura\'s score is the primary signal when available; duration alone provides a baseline otherwise.' },
  { name: 'Activity', desc: 'Uses steps, active minutes, and workout data from Apple Health or Strava. Weighted toward intensity and consistency over raw step count. Null if no activity data exists for the day.' },
  { name: 'Recovery', desc: 'Based on Oura readiness score and HRV. Reflects how prepared your body is for exertion. Requires Oura for meaningful scores.' },
  { name: 'Resilience', desc: 'A composite of sleep, activity, and recovery \u2014 weighted toward whichever signals are available. Represents overall adaptive capacity for the day.' },
];

// ── FlipCard component ───────────────────────────────────────────────────────
function FlipCard({ front, back, style }) {
  const [flipped, setFlipped] = useState(false);
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      style={{
        perspective: 1000,
        cursor: 'pointer',
        ...style,
      }}
    >
      <div style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        transformStyle: 'preserve-3d',
        transition: 'transform 0.4s ease',
        transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
        }}>
          {front}
        </div>
        <div style={{
          position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
          backfaceVisibility: 'hidden',
          WebkitBackfaceVisibility: 'hidden',
          transform: 'rotateY(180deg)',
        }}>
          {back}
        </div>
      </div>
    </div>
  );
}

// ── Service flip card ────────────────────────────────────────────────────────
function ServiceFlipCard({ svc, isOwner }) {
  const cardBase = {
    ...LAYER_CARD, borderLeft: `3px solid ${svc.color}`,
    padding: '14px 16px', height: '100%',
    display: 'flex', flexDirection: 'column', gap: 6,
    boxSizing: 'border-box',
  };
  const front = (
    <div style={cardBase}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>{svc.emoji}</span>
        <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: svc.color, letterSpacing: '0.04em' }}>
          {svc.name}
        </div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', lineHeight: '1.6', flex: 1 }}>
        {svc.desc}
      </div>
      <div style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-border2)', textAlign: 'right' }}>
        tap to flip
      </div>
    </div>
  );
  const back = (
    <div style={{ ...cardBase, background: 'var(--dl-bg)', borderLeft: `3px solid ${svc.color}44` }}>
      <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color: svc.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {svc.provider}
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', lineHeight: '1.6', flex: 1 }}>
        {svc.techDetail}
      </div>
      {isOwner && svc.dashboard && (
        <a
          href={svc.dashboard}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          style={{
            fontFamily: mono, fontSize: 9, letterSpacing: '0.04em', color: 'var(--dl-accent)',
            textDecoration: 'none', transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          Check billing &rarr;
        </a>
      )}
      <div style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-border2)', textAlign: 'right' }}>
        tap to flip back
      </div>
    </div>
  );
  return <FlipCard front={front} back={back} style={{ height: 130 }} />;
}

// ── Data category flip card ──────────────────────────────────────────────────
function DataFlipCard({ cat }) {
  const cardBase = {
    background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
    borderRadius: 10, padding: '10px 12px', height: '100%',
    display: 'flex', flexDirection: 'column', gap: 4,
    boxSizing: 'border-box',
  };
  const front = (
    <div style={cardBase}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>{cat.emoji}</span>
        <div>
          <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color: 'var(--dl-strong)', letterSpacing: '0.04em' }}>
            {cat.label}
          </div>
          <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', lineHeight: '1.5' }}>
            {cat.desc}
          </div>
        </div>
      </div>
      <div style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-border2)', textAlign: 'right', marginTop: 'auto' }}>
        tap to flip
      </div>
    </div>
  );
  const back = (
    <div style={{ ...cardBase, background: 'var(--dl-bg)' }}>
      <div style={{ fontFamily: mono, fontSize: 9, fontWeight: 600, color: 'var(--dl-accent)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Tables
      </div>
      <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', lineHeight: '1.5' }}>
        {cat.tables}
      </div>
      <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)', lineHeight: '1.5', marginTop: 2 }}>
        {cat.techDetail}
      </div>
      <div style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-border2)', textAlign: 'right', marginTop: 'auto' }}>
        tap to flip back
      </div>
    </div>
  );
  return <FlipCard front={front} back={back} style={{ height: 90 }} />;
}

// ── Score row ────────────────────────────────────────────────────────────────
function ScoreRow({ name, desc }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '11px 0', borderBottom: '1px solid var(--dl-border)' }}>
      <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-strong)', flexShrink: 0, width: 110, letterSpacing: '0.02em' }}>{name}</span>
      <span style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-middle)', lineHeight: 1.7 }}>{desc}</span>
    </div>
  );
}

// ── Stat pill ────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100,
    }}>
      <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 600, color: color || 'var(--dl-strong)', letterSpacing: '-0.02em' }}>
        {value ?? '\u2014'}
      </span>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dl-middle)' }}>
        {label}
      </span>
    </div>
  );
}

// ── Feedback entry row ───────────────────────────────────────────────────────
function FeedbackRow({ entry, onStatusChange }) {
  const statusCol = STATUS_COLORS[entry.status] || 'var(--dl-middle)';
  const nextStatus = entry.status === 'new' ? 'read' : entry.status === 'read' ? 'resolved' : 'new';
  return (
    <div style={{
      background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
      borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {entry.user_email}
        </span>
        <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)', flexShrink: 0 }}>
          {new Date(entry.created_at).toLocaleDateString()}
        </span>
        <button onClick={() => onStatusChange(entry.id, nextStatus)} style={{
          fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase',
          color: statusCol, background: statusCol + '18', border: `1px solid ${statusCol}44`,
          borderRadius: 6, padding: '2px 8px', cursor: 'pointer', flexShrink: 0,
          transition: 'opacity 0.15s',
        }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
          title={`Click to mark as ${nextStatus}`}
        >
          {entry.status}
        </button>
      </div>
      <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-strong)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
        {entry.text}
      </div>
    </div>
  );
}

// ── Inner page ───────────────────────────────────────────────────────────────
function AboutInner({ token }) {
  const [isOwner, setIsOwner] = useState(false);
  const [status, setStatus] = useState(null);
  const [arch, setArch] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetches = [
      fetch('/architecture.json').catch(() => null),
    ];

    if (token) {
      fetches.push(
        fetch('/api/admin/status', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/admin/feedback', { headers: { Authorization: `Bearer ${token}` } }),
      );
    }

    Promise.all(fetches).then(async ([archRes, statusRes, fbRes]) => {
      if (archRes && archRes.ok) setArch(await archRes.json());
      if (statusRes && statusRes.ok) {
        setIsOwner(true);
        setStatus(await statusRes.json());
      }
      if (fbRes && fbRes.ok) {
        const data = await fbRes.json();
        setFeedback(data.feedback || []);
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token]);

  const updateFeedbackStatus = useCallback(async (id, newStatus) => {
    const res = await fetch('/api/admin/feedback', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: newStatus }),
    });
    if (res.ok) {
      setFeedback(prev => prev.map(f => f.id === id ? { ...f, status: newStatus } : f));
    }
  }, [token]);

  // Derive tech pills from architecture.json
  const techPills = [];
  if (arch) {
    const cat = arch.client?.libraryCategories || {};
    if (cat.ui) techPills.push({ label: 'React', color: '#61DAFB' }, { label: 'Next.js', color: 'var(--dl-strong)' });
    if (cat.editor?.length) techPills.push({ label: 'Tiptap', color: 'var(--dl-accent)' });
    if (cat['3d']?.length) techPills.push({ label: 'Three.js', color: '#049EF4' });
    if (cat.maps?.length) techPills.push({ label: 'Leaflet', color: '#199900' });
    if (cat.dnd?.length) techPills.push({ label: 'Drag & Drop', color: 'var(--dl-middle)' });
    techPills.push({ label: 'Vercel', color: 'var(--dl-strong)' });
    techPills.push({ label: 'Supabase', color: '#3ECF8E' });
    techPills.push({ label: 'Claude AI', color: '#D4A574' });
    techPills.push({ label: 'Whisper', color: '#F55036' });
    techPills.push({ label: 'TTS', color: '#74AA9C' });
    if (cat.payments?.length) techPills.push({ label: 'Stripe', color: '#635BFF' });
  }

  if (loading) {
    return (
      <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-highlight)', letterSpacing: '0.2em', textAlign: 'center', padding: 40 }}>
        loading...
      </div>
    );
  }

  const st = status?.stats;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

      {/* 1. Owner-only: Stats bar */}
      {isOwner && st && (
        <div style={{
          background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
          borderRadius: 14, padding: '16px 18px',
        }}>
          <div style={SECTION_LABEL}>Owner Stats</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatPill label="Premium" value={st.premiumCount} color="#5BA89D" />
            <StatPill label="Free" value={st.freeCount} />
            <StatPill label="Total Users" value={st.userCount} />
            {arch && (
              <>
                <StatPill label="API Routes" value={arch.apiRoutes.length} color="#6BAED6" />
                <StatPill label="DB Tables" value={arch.services?.supabase?.tables?.length || 0} color="#3ECF8E" />
              </>
            )}
          </div>
        </div>
      )}

      {/* 2. What is Day Lab */}
      <div>
        <div style={SECTION_LABEL}>What is Day Lab</div>
        <div style={BODY_TEXT}>
          <p style={{ margin: '0 0 14px' }}>
            Day Lab is a personal health OS &mdash; a single place to log meals, tasks, notes, and workouts, with AI that surfaces patterns across your data over time.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            It pulls data from Oura, Strava, and Apple Health and combines it with what you log manually &mdash; meals, tasks, notes, journal entries &mdash; into a unified daily view.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            The AI Insights feature reads your actual data and generates a short analysis each day: what your sleep and recovery look like, how your activity compares to recent weeks, and whether patterns in your nutrition or schedule are worth paying attention to.
          </p>
          <p style={{ margin: 0 }}>
            The voice entry bar lets you log anything in natural language. &quot;Had eggs and coffee for breakfast, 30 min run, feeling good&quot; &mdash; Day Lab parses and stores it.
          </p>
        </div>
      </div>

      {/* 3. How Day Lab Works — architecture with flippable cards */}
      <div style={SECTION_LABEL}>How Day Lab Works</div>

      {/* Layer 1: Your Device */}
      <div style={{ ...LAYER_CARD, borderLeft: '3px solid var(--dl-accent)' }}>
        <div style={LAYER_TITLE('var(--dl-accent)')}>
          {'\uD83D\uDCBB'} Your Device
        </div>
        <div style={LAYER_DESC}>
          You interact with Day Lab through your browser or desktop app. Everything you see &mdash; the journal, tasks, habits, maps &mdash; runs right here on your device.
        </div>
      </div>

      <div style={ARROW_STYLE}>{'\u2193'}</div>

      {/* Layer 2: The Brain */}
      <div style={{ ...LAYER_CARD, borderLeft: '3px solid #6BAED6' }}>
        <div style={LAYER_TITLE('#6BAED6')}>
          {'\u2699\uFE0F'} The Brain
        </div>
        <div style={LAYER_DESC}>
          When you save an entry, add a meal, or ask the AI something, your device sends it to our server. The server decides what to do &mdash; store your data, ask AI for help, or sync with your calendar.
          {arch && (
            <span style={{ color: 'var(--dl-border2)' }}>
              {' '}({arch.apiRoutes.length} different actions available)
            </span>
          )}
        </div>
      </div>

      <div style={ARROW_STYLE}>{'\u2193'}</div>

      {/* Layer 3: Connected Services — flippable cards */}
      <div>
        <div style={SECTION_LABEL}>Connected Services</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
          {CONNECTED_SERVICES.map(svc => (
            <ServiceFlipCard key={svc.name} svc={svc} isOwner={isOwner} />
          ))}
        </div>
      </div>

      {/* What We Store — flippable cards */}
      <div>
        <div style={SECTION_LABEL}>What We Store</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
          {DATA_CATEGORIES.map(cat => (
            <DataFlipCard key={cat.label} cat={cat} />
          ))}
        </div>
      </div>

      {/* 4. How Scores Work */}
      <div>
        <div style={SECTION_LABEL}>How Scores Are Calculated</div>
        <div style={BODY_TEXT}>
          <p style={{ margin: '0 0 16px' }}>
            Each day gets up to four scores, each 0&ndash;100. Scores only appear when there&rsquo;s real data to calculate from &mdash; you&rsquo;ll never see a fabricated number.
          </p>
        </div>
        <div style={{
          border: '1px solid var(--dl-border)', borderRadius: 8,
          overflow: 'hidden', marginBottom: 16,
        }}>
          {SCORES.map(s => (
            <ScoreRow key={s.name} name={s.name} desc={s.desc} />
          ))}
        </div>
        <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', lineHeight: 1.7 }}>
          Historical scores are backfilled when you first connect a data source, and recalculated whenever you reconnect. You can always trigger a recalculation by disconnecting and reconnecting a source.
        </div>
      </div>

      {/* 5. Data & Privacy */}
      <div>
        <div style={SECTION_LABEL}>Data &amp; Privacy</div>
        <div style={BODY_TEXT}>
          <p style={{ margin: '0 0 14px' }}>
            Your data is stored in a private Supabase database tied to your account. Day Lab does not sell your data or share it with third parties.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            AI insights are generated by sending your health metrics to the Anthropic Claude API. This data is not used to train AI models under Anthropic&rsquo;s API terms.
          </p>
          <p style={{ margin: 0 }}>
            Oura tokens are stored encrypted in your settings row. Apple Health data is synced on-device via the iOS app and sent to your account over HTTPS.
          </p>
        </div>
      </div>

      {/* 6. Built With */}
      {techPills.length > 0 && (
        <div>
          <div style={SECTION_LABEL}>Built With</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {techPills.map(t => (
              <span key={t.label} style={{
                fontFamily: mono, fontSize: 9, letterSpacing: '0.06em',
                color: t.color, background: (t.color.startsWith('#') ? t.color : '') + '14',
                border: `1px solid ${t.color.startsWith('#') ? t.color + '33' : 'var(--dl-border)'}`,
                borderRadius: 100, padding: '3px 10px',
              }}>
                {t.label}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timestamp */}
      {arch && (
        <div style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-border2)', textAlign: 'right' }}>
          Auto-generated {new Date(arch.generatedAt).toLocaleDateString()}
        </div>
      )}

      {/* 7. Legal links footer */}
      <div style={{ borderTop: '1px solid var(--dl-border)', paddingTop: 28, display: 'flex', gap: 24 }}>
        <a href="/terms" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dl-border2)', textDecoration: 'none' }}>Terms of Service</a>
        <a href="/privacy" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dl-border2)', textDecoration: 'none' }}>Privacy Policy</a>
        <a href="mailto:hello@daylab.me" style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dl-border2)', textDecoration: 'none' }}>Contact</a>
      </div>

      {/* 8. Owner-only: Feedback section at bottom */}
      {isOwner && (
        <div>
          <div style={SECTION_LABEL}>
            Feedback ({feedback.length})
          </div>
          {feedback.length === 0 ? (
            <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', padding: '8px 0' }}>
              No feedback yet.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
              {feedback.map(f => (
                <FeedbackRow key={f.id} entry={f} onStatusChange={updateFeedbackStatus} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AboutPage() {
  return (
    <StandaloneShell label="About">
      {({ token }) => <AboutInner token={token} />}
    </StandaloneShell>
  );
}
