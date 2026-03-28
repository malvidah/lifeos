"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { mono, F } from "@/lib/tokens";

const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });

const SECTION_LABEL = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 8 };
const STATUS_COLORS = { new: '#E8917A', read: '#6BAED6', resolved: '#5BA89D' };

// ── Service card ──────────────────────────────────────────────────────────────
function ServiceCard({ name, configured, detail, model, notes, dashboard }) {
  return (
    <div style={{
      background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
          background: configured ? '#5BA89D' : 'var(--dl-border2)',
          boxShadow: configured ? '0 0 6px #5BA89D66' : 'none',
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-strong)' }}>
            {name}
          </div>
        </div>
        <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: configured ? '#5BA89D' : 'var(--dl-border2)', flexShrink: 0 }}>
          {configured ? 'active' : 'not set'}
        </span>
      </div>
      {detail && (
        <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {detail}
        </div>
      )}
      {model && (
        <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-accent)' }}>
          {model}
        </div>
      )}
      {notes && (
        <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)' }}>
          {notes}
        </div>
      )}
      {dashboard && (
        <a href={dashboard} target="_blank" rel="noopener noreferrer" style={{
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
}

// ── Architecture section (visual, plain-language) ────────────────────────────

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

const CONNECTED_SERVICES = [
  { emoji: '\uD83D\uDDC4\uFE0F', name: 'Database', provider: 'Supabase', color: '#3ECF8E',
    desc: 'Stores all your data \u2014 journal, tasks, meals, health, goals, habits' },
  { emoji: '\uD83E\uDDE0', name: 'AI', provider: 'Anthropic Claude', color: '#D4A574',
    desc: 'Powers the chat assistant, daily insights, and voice commands' },
  { emoji: '\uD83C\uDF99\uFE0F', name: 'Voice', provider: 'Groq', color: '#F55036',
    desc: 'Converts your voice recordings into text' },
  { emoji: '\uD83D\uDD0A', name: 'Speech', provider: 'OpenAI', color: '#74AA9C',
    desc: 'Reads AI responses back to you' },
  { emoji: '\uD83D\uDCC5', name: 'Calendar', provider: 'Google', color: '#4285F4',
    desc: 'Syncs events with your Google Calendar' },
];

const DATA_CATEGORIES = [
  { emoji: '\u270D\uFE0F', label: 'Your Writing', desc: 'Journal entries, notes' },
  { emoji: '\u2705', label: 'Your Tasks & Goals', desc: 'Tasks, goals, habits, completions' },
  { emoji: '\uD83D\uDCAA', label: 'Your Health', desc: 'Sleep, HRV, steps, scores, workouts' },
  { emoji: '\uD83C\uDF7D\uFE0F', label: 'Your Food', desc: 'Meals with nutrition estimates' },
  { emoji: '\uD83D\uDCCD', label: 'Your Places', desc: 'Locations and places visited' },
  { emoji: '\uD83D\uDCC6', label: 'Your Calendar', desc: 'Events synced from Google' },
  { emoji: '\u2699\uFE0F', label: 'Your Settings', desc: 'Theme, preferences, premium status' },
];

function HowItWorks({ arch }) {
  // Derive tech pills from architecture.json
  const techPills = [];
  if (arch) {
    const cat = arch.client.libraryCategories || {};
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={SECTION_LABEL}>How Day Lab Works</div>

      {/* Layer 1: Your Device */}
      <div style={{ ...LAYER_CARD, borderLeft: '3px solid var(--dl-accent)' }}>
        <div style={LAYER_TITLE('var(--dl-accent)')}>
          {'\uD83D\uDCBB'} Your Device
        </div>
        <div style={LAYER_DESC}>
          You interact with Day Lab through your browser or desktop app. Everything you see — the journal, tasks, habits, maps — runs right here on your device.
        </div>
      </div>

      <div style={ARROW_STYLE}>{'\u2193'}</div>

      {/* Layer 2: The Brain */}
      <div style={{ ...LAYER_CARD, borderLeft: '3px solid #6BAED6' }}>
        <div style={LAYER_TITLE('#6BAED6')}>
          {'\u2699\uFE0F'} The Brain
        </div>
        <div style={LAYER_DESC}>
          When you save an entry, add a meal, or ask the AI something, your device sends it to our server. The server decides what to do — store your data, ask AI for help, or sync with your calendar.
          {arch && (
            <span style={{ color: 'var(--dl-border2)' }}>
              {' '}({arch.apiRoutes.length} different actions available)
            </span>
          )}
        </div>
      </div>

      <div style={ARROW_STYLE}>{'\u2193'}</div>

      {/* Layer 3: Connected Services */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>Connected Services</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {CONNECTED_SERVICES.map(svc => (
            <div key={svc.name} style={{
              ...LAYER_CARD, borderLeft: `3px solid ${svc.color}`,
              padding: '12px 14px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 16 }}>{svc.emoji}</span>
                <div>
                  <div style={{ fontFamily: mono, fontSize: 11, fontWeight: 600, color: svc.color, letterSpacing: '0.04em' }}>
                    {svc.name}
                  </div>
                  <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)' }}>
                    {svc.provider}
                  </div>
                </div>
              </div>
              <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', lineHeight: '1.6' }}>
                {svc.desc}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What We Store */}
      <div style={{ marginTop: 8 }}>
        <div style={SECTION_LABEL}>What We Store</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
          {DATA_CATEGORIES.map(cat => (
            <div key={cat.label} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
              borderRadius: 10, padding: '10px 12px',
            }}>
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
          ))}
        </div>
      </div>

      {/* Built With */}
      {techPills.length > 0 && (
        <div style={{ marginTop: 8 }}>
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
    </div>
  );
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value, color }) {
  return (
    <div style={{
      background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100,
    }}>
      <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 600, color: color || 'var(--dl-strong)', letterSpacing: '-0.02em' }}>
        {value ?? '—'}
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

// ── Inner page ────────────────────────────────────────────────────────────────
function DeveloperInner({ token }) {
  const [status, setStatus] = useState(null);
  const [arch, setArch] = useState(null);
  const [feedback, setFeedback] = useState([]);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    Promise.all([
      fetch('/api/admin/status', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/api/admin/feedback', { headers: { Authorization: `Bearer ${token}` } }),
      fetch('/architecture.json').catch(() => null),
    ]).then(async ([statusRes, fbRes, archRes]) => {
      if (statusRes.status === 403) { setForbidden(true); setLoading(false); return; }
      if (statusRes.ok) setStatus(await statusRes.json());
      if (fbRes.ok) {
        const data = await fbRes.json();
        setFeedback(data.feedback || []);
      }
      if (archRes && archRes.ok) setArch(await archRes.json());
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    if (forbidden) window.location.href = '/';
  }, [forbidden]);

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

  if (loading) {
    return (
      <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-highlight)', letterSpacing: '0.2em', textAlign: 'center', padding: 40 }}>
        loading...
      </div>
    );
  }

  if (!status) return null;

  const svc = status.services;
  const st = status.stats;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Quick Stats */}
      <div>
        <div style={SECTION_LABEL}>Stats</div>
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

      {/* Connected Services */}
      <div>
        <div style={SECTION_LABEL}>Connected Services</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <ServiceCard name="Supabase" configured={svc.supabase.configured}
            detail={svc.supabase.domain} notes={svc.supabase.notes}
            dashboard={svc.supabase.dashboard} />
          <ServiceCard name="Anthropic" configured={svc.anthropic.configured}
            model={svc.anthropic.model} notes={svc.anthropic.notes}
            dashboard={svc.anthropic.dashboard} />
          <ServiceCard name="OpenAI" configured={svc.openai.configured}
            model={svc.openai.model} notes={svc.openai.notes}
            dashboard={svc.openai.dashboard} />
          <ServiceCard name="Groq" configured={svc.groq.configured}
            model={svc.groq.model} notes={svc.groq.notes}
            dashboard={svc.groq.dashboard} />
          <ServiceCard name="Google" configured={svc.google.configured}
            notes={svc.google.notes} dashboard={svc.google.dashboard} />
          <ServiceCard name="Vercel" configured={svc.vercel.configured}
            detail={svc.vercel.url} notes={svc.vercel.notes}
            dashboard={svc.vercel.dashboard} />
        </div>
      </div>

      {/* How It Works */}
      <HowItWorks arch={arch} />

      {/* Feedback */}
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
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DeveloperPage() {
  return (
    <StandaloneShell label="Developer">
      {({ token }) => <DeveloperInner token={token} />}
    </StandaloneShell>
  );
}
