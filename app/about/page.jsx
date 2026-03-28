"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { mono, serif, F } from "@/lib/tokens";

const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });

const SECTION_LABEL = { fontFamily: mono, fontSize: 12, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-highlight)', marginBottom: 8 };
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
  fontFamily: serif, fontSize: 13, color: 'var(--dl-middle)', lineHeight: '1.7',
};
const ARROW_STYLE = {
  fontFamily: mono, fontSize: 18, color: 'var(--dl-border2)',
  textAlign: 'center', padding: '0', lineHeight: 1,
  margin: '-4px 0',
};
const BODY_TEXT = {
  fontFamily: serif, fontSize: 14, color: 'var(--dl-middle)', lineHeight: 1.85,
};
const CARD_DESC = {
  fontFamily: serif, fontSize: 12, color: 'var(--dl-middle)', lineHeight: '1.6',
};

// ── System services ──────────────────────────────────────────────────────────
const SYSTEM_SERVICES = [
  { emoji: '\uD83D\uDDC4\uFE0F', name: 'Database', provider: 'Supabase', color: '#3ECF8E',
    desc: 'Stores all your data \u2014 journal, tasks, meals, health, goals, habits',
    techDetail: 'PostgreSQL with Row Level Security, real-time subscriptions',
    dashboard: 'https://supabase.com/dashboard' },
  { emoji: '\uD83E\uDDE0', name: 'AI', provider: 'Anthropic Claude', color: '#D4A574',
    desc: 'Powers the chat assistant and voice commands',
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

// ── User-connected services ──────────────────────────────────────────────────
const USER_SERVICES = [
  { emoji: '\uD83D\uDC8D', name: 'Oura Ring', provider: 'Oura', color: '#C4B5A0',
    desc: 'Syncs sleep, HRV, readiness, and recovery scores',
    techDetail: 'Connect in Settings \u2192 Oura. Uses OAuth to pull daily metrics.' },
  { emoji: '\u231A', name: 'Apple Health', provider: 'Apple', color: '#FF6961',
    desc: 'Syncs steps, heart rate, sleep, and workouts from your watch',
    techDetail: 'Connect via the Day Lab iOS app. Data synced on-device over HTTPS.' },
  { emoji: '\uD83C\uDFC3', name: 'Strava', provider: 'Strava', color: '#FC4C02',
    desc: 'Imports your runs, rides, and workout activities',
    techDetail: 'Connect in Settings \u2192 Strava. Uses OAuth to import activities.' },
];

// ── App feature explainers ───────────────────────────────────────────────────
const APP_FEATURES = [
  { emoji: '\u26F0\uFE0F', name: 'Projects', color: '#E8917A',
    desc: 'Each project becomes a 3D mountain. The more you work on it, the taller it grows. Active projects glow, stale ones get snow.',
    back: 'Projects are created automatically when you tag anything. Type /p day lab in a task or journal entry and the project appears on the map.' },
  { emoji: '\uD83C\uDFC1', name: 'Goals', color: '#6BAED6',
    desc: 'Concrete milestones you want to hit. Organize by project or track by status \u2014 active, planned, completed.',
    back: 'Create goals in the Goals card, or type /g goal name in any task to auto-create and link. Goals show how many tasks and habits are connected.' },
  { emoji: '\uD83C\uDFAF', name: 'Habits', color: '#5BA89D',
    desc: 'Recurring tasks with streaks. Set any schedule \u2014 daily, M\u00b7W\u00b7F, 3x per week, or any custom combo.',
    back: 'Create in the Habits card, or add /h mwf (or /h daily, /h 2pw, etc.) to any task. Habits auto-cascade \u2014 add /p and /g to link them to projects and goals in one line.' },
  { emoji: '\u2611\uFE0F', name: 'Tasks', color: '#D4A574',
    desc: 'Your daily to-do list. The fastest way to create anything \u2014 type a task with inline tags to build your whole system.',
    back: 'Power syntax: "Run 5k /h mwf /g half marathon /p health" creates a habit linked to a goal on a project, all in one line. Tags: /p project, /g goal, /h schedule, @date.' },
  { emoji: '\u270F\uFE0F', name: 'Journal', color: '#9B8EC4',
    desc: 'Free-form writing for each day. Your thoughts, reflections, and notes in one place.',
    back: 'Rich text editor with inline project tags. Tag entries with /p to connect them to projects. Notes are separate from daily journal \u2014 persistent documents you can link to.' },
  { emoji: '\uD83C\uDF7D\uFE0F', name: 'Meals', color: '#8DB86B',
    desc: 'Log what you eat. AI estimates calories and protein in the background.',
    back: 'Just type the food \u2014 "salmon and rice" \u2014 and AI fills in nutrition. You can also use voice: "add oatmeal for breakfast."' },
  { emoji: '\uD83D\uDC9A', name: 'Health', color: '#5BA89D',
    desc: 'Daily scores from your wearables \u2014 sleep, activity, recovery, and resilience.',
    back: 'Sleep: Oura score + hours slept. Activity: steps + workout intensity. Recovery: HRV + readiness. Resilience: how all three combine. Scores update when your ring syncs.' },
  { emoji: '\uD83E\uDD16', name: 'AI Assistant', color: '#D4A574',
    desc: 'Add anything by voice or text. Ask questions about your data. Review changes before they\u2019re saved.',
    back: 'Hover over "Ask AI" to open the quick bar, or click the chat icon for full sidebar. Say "add a goal: run a marathon" or "log oatmeal for breakfast" \u2014 accept or reject with one tap.' },
];

// ── FlipCard component — front/back overlap, subtle hover ───────────────────
function FlipCard({ front, back, style }) {
  const [flipped, setFlipped] = useState(false);
  const [hovered, setHovered] = useState(false);
  return (
    <div
      onClick={() => setFlipped(f => !f)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: 'pointer', position: 'relative',
        borderRadius: 14,
        boxShadow: hovered ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
        transition: 'box-shadow 0.2s ease',
        ...style,
      }}
    >
      <div style={{ height: '100%', visibility: flipped ? 'hidden' : 'visible', opacity: flipped ? 0 : 1, transition: 'opacity 0.2s ease' }}>
        {front}
      </div>
      <div style={{ position: 'absolute', inset: 0, visibility: flipped ? 'visible' : 'hidden', opacity: flipped ? 1 : 0, transition: 'opacity 0.2s ease' }}>
        {back}
      </div>
    </div>
  );
}

// ── Service flip card ────────────────────────────────────────────────────────
function ServiceFlipCard({ svc, isOwner }) {
  const cardBase = {
    ...LAYER_CARD,
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
      <div style={{ ...CARD_DESC, flex: 1 }}>
        {svc.desc}
      </div>
    </div>
  );
  const back = (
    <div style={{ ...cardBase, background: 'var(--dl-bg)' }}>
      <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color: svc.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        {svc.provider}
      </div>
      <div style={{ ...CARD_DESC, flex: 1 }}>
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
    </div>
  );
  return <FlipCard front={front} back={back} style={{ height: 130 }} />;
}

// ── Feature explainer flip card ──────────────────────────────────────────────
function FeatureFlipCard({ feat }) {
  const cardBase = {
    ...LAYER_CARD,
    padding: '14px 16px', height: '100%',
    display: 'flex', flexDirection: 'column', gap: 6,
    boxSizing: 'border-box',
  };
  const front = (
    <div style={cardBase}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 20 }}>{feat.emoji}</span>
        <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, color: feat.color, letterSpacing: '0.04em' }}>
          {feat.name}
        </div>
      </div>
      <div style={{ ...CARD_DESC, flex: 1 }}>
        {feat.desc}
      </div>
    </div>
  );
  const back = (
    <div style={{ ...cardBase, background: 'var(--dl-bg)' }}>
      <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color: feat.color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        How to use
      </div>
      <div style={{ ...CARD_DESC, flex: 1 }}>
        {feat.back}
      </div>
    </div>
  );
  return <FlipCard front={front} back={back} style={{ height: 150 }} />;
}

// ── Architecture layer flip card ─────────────────────────────────────────────
function LayerFlipCard({ emoji, title, color, frontText, backText, archRouteCount }) {
  const cardBase = {
    ...LAYER_CARD,
    height: '100%', display: 'flex', flexDirection: 'column',
    boxSizing: 'border-box',
  };
  const front = (
    <div style={cardBase}>
      <div style={LAYER_TITLE(color)}>
        {emoji} {title}
      </div>
      <div style={{ ...LAYER_DESC, flex: 1 }}>
        {frontText}
        {archRouteCount != null && (
          <span style={{ color: 'var(--dl-border2)' }}>
            {' '}({archRouteCount} different actions available)
          </span>
        )}
      </div>
    </div>
  );
  const back = (
    <div style={{ ...cardBase, background: 'var(--dl-bg)' }}>
      <div style={{ ...LAYER_TITLE(color), opacity: 0.7 }}>
        {emoji} {title}
      </div>
      <div style={{ ...CARD_DESC, flex: 1 }}>
        {backText}
      </div>
    </div>
  );
  return <FlipCard front={front} back={back} style={{ minHeight: 140 }} />;
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
      <div style={{ fontFamily: serif, fontSize: 13, color: 'var(--dl-strong)', lineHeight: '1.6', whiteSpace: 'pre-wrap' }}>
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
  const routeCount = arch?.apiRoutes?.length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>

      {/* 1. DAY LAB STATS (owner only) */}
      {isOwner && st && (
        <div style={LAYER_CARD}>
          <div style={SECTION_LABEL}>Day Lab Stats</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <StatPill label="Premium" value={st.premiumCount} color="#5BA89D" />
            <StatPill label="Free" value={st.freeCount} />
            <StatPill label="Total Users" value={st.userCount} />
            {arch && (
              <>
                <StatPill label="API Routes" value={routeCount} color="#6BAED6" />
                <StatPill label="DB Tables" value={arch.services?.supabase?.tables?.length || 0} color="#3ECF8E" />
              </>
            )}
          </div>
        </div>
      )}

      {/* 2. What is Day Lab */}
      <div style={LAYER_CARD}>
        <div style={SECTION_LABEL}>What is Day Lab</div>
        <div style={BODY_TEXT}>
          <p style={{ margin: '0 0 14px' }}>
            Day Lab is your personal operating system for life &mdash; a single place where everything about your day comes together.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            Log meals with a tap, track habits with a check, journal your thoughts, and use AI to add anything by voice. Your health data flows in from Oura and Apple Health. Your calendar syncs from Google.
          </p>
          <p style={{ margin: 0 }}>
            Every day, Day Lab builds a picture of how you{"'"}re doing — not just what you ate or how you slept, but how it all fits together. The 3D mountain map shows your projects growing over time. Health scores are calculated from your wearable data. And everything lives in one beautiful, private dashboard that{"'"}s actually yours.
          </p>
        </div>
      </div>

      {/* 3. How to Use Day Lab — feature explainer flip cards */}
      <div style={LAYER_CARD}>
        <div style={SECTION_LABEL}>How to Use Day Lab</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          {APP_FEATURES.map(feat => (
            <FeatureFlipCard key={feat.name} feat={feat} />
          ))}
        </div>
      </div>

      {/* 4. How Day Lab Works — architecture */}
      <div style={LAYER_CARD}>
        <div style={{ ...SECTION_LABEL, marginBottom: 12 }}>How Day Lab Works</div>

        {/* Layer 1: Your Device */}
        <LayerFlipCard
          emoji={'\uD83D\uDCBB'}
          title="Your Device"
          color="var(--dl-accent)"
          frontText="You interact with Day Lab through your browser or desktop app. Everything you see — the journal, tasks, habits, maps — runs right here on your device."
          backText="Built with React and Next.js. The editor uses Tiptap with custom extensions for tasks, habits, and tags. The 3D project map uses Three.js. Voice input uses your browser's speech recognition or Groq's Whisper AI."
        />

        <div style={ARROW_STYLE}>{'\u2193'}</div>

        {/* Layer 2: The Brain */}
        <LayerFlipCard
          emoji={'\u2699\uFE0F'}
          title="The Brain"
          color="#6BAED6"
          frontText="When you save an entry, add a meal, or ask the AI something, your device sends it to our server. The server decides what to do — store your data, ask AI for help, or sync with your calendar."
          backText={`Runs on Vercel as serverless functions.${routeCount ? ` ${routeCount} API endpoints` : ' API endpoints'} handle everything from saving a journal entry to asking AI a question. Each request is authenticated and your data is isolated with row-level security.`}
          archRouteCount={null}
        />

        <div style={ARROW_STYLE}>{'\u2193'}</div>

        {/* System Services */}
        <div>
          <div style={{ ...SECTION_LABEL, marginBottom: 4 }}>System Services</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {SYSTEM_SERVICES.map(svc => (
              <ServiceFlipCard key={svc.name} svc={svc} isOwner={isOwner} />
            ))}
          </div>
        </div>

        <div style={{ ...ARROW_STYLE, margin: '4px 0' }}>{'\u2193'}</div>

        {/* User Connections */}
        <div>
          <div style={{ ...SECTION_LABEL, marginBottom: 4 }}>Your Connections</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
            {USER_SERVICES.map(svc => (
              <ServiceFlipCard key={svc.name} svc={svc} isOwner={isOwner} />
            ))}
          </div>
        </div>
      </div>

      {/* 5. Data & Privacy */}
      <div style={LAYER_CARD}>
        <div style={SECTION_LABEL}>Data &amp; Privacy</div>
        <div style={BODY_TEXT}>
          <p style={{ margin: '0 0 14px' }}>
            Your data is stored in a private Supabase database tied to your account. Day Lab does not sell your data or share it with third parties.
          </p>
          <p style={{ margin: '0 0 14px' }}>
            Health scores are calculated locally from your wearable data — no AI is involved and no health data is sent to third parties. The AI chat assistant uses Anthropic{"'"}s Claude API only when you ask it something. This data is not used to train AI models under Anthropic{"'"}s API terms.
          </p>
          <p style={{ margin: 0 }}>
            Oura tokens are stored encrypted in your settings row. Apple Health data is synced on-device via the iOS app and sent to your account over HTTPS.
          </p>
        </div>
      </div>

      {/* 6. Built With */}
      {techPills.length > 0 && (
        <div style={LAYER_CARD}>
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

      {/* 8. Feedback (owner only) */}
      {isOwner && (
        <div style={LAYER_CARD}>
          <div style={SECTION_LABEL}>
            Feedback ({feedback.length})
          </div>
          {feedback.length === 0 ? (
            <div style={{ fontFamily: serif, fontSize: 13, color: 'var(--dl-border2)', padding: '8px 0' }}>
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
