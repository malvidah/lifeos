"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { mono, F } from "@/lib/tokens";
import { api } from "@/lib/api";

const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });

// ── Service card ──────────────────────────────────────────────────────────────
function ServiceCard({ name, configured, detail }) {
  return (
    <div style={{
      background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{
        width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
        background: configured ? '#5BA89D' : 'var(--dl-border2)',
        boxShadow: configured ? '0 0 6px #5BA89D66' : 'none',
      }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: mono, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-strong)' }}>
          {name}
        </div>
        {detail && (
          <div style={{ fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detail}
          </div>
        )}
      </div>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: configured ? '#5BA89D' : 'var(--dl-border2)', flexShrink: 0 }}>
        {configured ? 'active' : 'not set'}
      </span>
    </div>
  );
}

// ── Architecture diagram ──────────────────────────────────────────────────────
function ArchDiagram() {
  const nodeStyle = (color) => ({
    fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
    color, background: color + '18', border: `1px solid ${color}44`,
    borderRadius: 8, padding: '8px 14px', whiteSpace: 'nowrap',
  });
  const arrow = { fontFamily: mono, fontSize: 12, color: 'var(--dl-border2)', flexShrink: 0 };

  const backends = [
    { label: 'Supabase', color: '#3ECF8E', note: 'data' },
    { label: 'Anthropic', color: '#D4A574', note: 'insights, chat' },
    { label: 'Groq', color: '#F55036', note: 'transcription' },
    { label: 'OpenAI', color: '#74AA9C', note: 'tts' },
    { label: 'Google', color: '#4285F4', note: 'calendar' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 2 }}>
        Architecture
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, overflowX: 'auto', paddingBottom: 4 }}>
        {/* Browser */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={nodeStyle('var(--dl-strong)')}>Browser</div>
        </div>

        <span style={{ ...arrow, alignSelf: 'center' }}>&rarr;</span>

        {/* Next.js */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={nodeStyle('var(--dl-accent)')}>Next.js API</div>
        </div>

        <span style={{ ...arrow, alignSelf: 'center' }}>&rarr;</span>

        {/* Backends */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {backends.map(b => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={nodeStyle(b.color)}>{b.label}</div>
              <span style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)' }}>{b.note}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Stat pill ─────────────────────────────────────────────────────────────────
function StatPill({ label, value }) {
  return (
    <div style={{
      background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100,
    }}>
      <span style={{ fontFamily: mono, fontSize: 22, fontWeight: 600, color: 'var(--dl-strong)', letterSpacing: '-0.02em' }}>
        {value ?? '—'}
      </span>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dl-middle)' }}>
        {label}
      </span>
    </div>
  );
}

// ── Inner page ────────────────────────────────────────────────────────────────
function DeveloperInner({ token }) {
  const [status, setStatus] = useState(null);
  const [forbidden, setForbidden] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    fetch('/api/admin/status', {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async res => {
      if (res.status === 403) { setForbidden(true); setLoading(false); return; }
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      setStatus(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [token]);

  // Redirect non-owners
  useEffect(() => {
    if (forbidden) window.location.href = '/';
  }, [forbidden]);

  if (loading) {
    return (
      <div style={{ fontFamily: mono, fontSize: F.sm, color: 'var(--dl-highlight)', letterSpacing: '0.2em', textAlign: 'center', padding: 40 }}>
        loading...
      </div>
    );
  }

  if (!status) return null;

  const svc = status.services;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Quick Stats */}
      <div>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 8 }}>
          Stats
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <StatPill label="Users" value={status.stats?.userCount} />
        </div>
      </div>

      {/* Connected Services */}
      <div>
        <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 8 }}>
          Connected Services
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
          <ServiceCard name="Supabase" configured={svc.supabase.configured} detail={svc.supabase.domain} />
          <ServiceCard name="Anthropic" configured={svc.anthropic.configured} detail="Claude — insights, chat" />
          <ServiceCard name="OpenAI" configured={svc.openai.configured} detail="TTS" />
          <ServiceCard name="Groq" configured={svc.groq.configured} detail="Transcription" />
          <ServiceCard name="Google" configured={svc.google.configured} detail="Calendar OAuth" />
          <ServiceCard name="Vercel" configured={!!svc.vercel.url} detail={svc.vercel.url} />
        </div>
      </div>

      {/* Architecture */}
      <div style={{
        background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
        borderRadius: 12, padding: 16,
      }}>
        <ArchDiagram />
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
