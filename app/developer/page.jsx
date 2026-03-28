"use client";
import { useState, useEffect, useCallback } from "react";
import dynamic from "next/dynamic";
import { mono, F } from "@/lib/tokens";

const StandaloneShell = dynamic(() => import("@/components/StandaloneShell"), { ssr: false });

const SECTION_LABEL = { fontFamily: mono, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 8 };
const STATUS_COLORS = { new: '#E8917A', read: '#6BAED6', resolved: '#5BA89D' };
const SVC_COLORS = {
  supabase: '#3ECF8E', anthropic: '#D4A574', groq: '#F55036',
  openai: '#74AA9C', google: '#4285F4',
};

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

// ── Architecture diagram (driven by architecture.json) ───────────────────────
function ArchDiagram({ arch }) {
  if (!arch) return (
    <div style={{ fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)', padding: '8px 0' }}>
      Architecture manifest not found. Run <code>npm run build</code> to generate.
    </div>
  );

  const box = (color) => ({
    border: `1px solid ${color}44`,
    borderRadius: 10, padding: '12px 16px',
    background: color + '08',
  });
  const headingStyle = (color) => ({
    fontFamily: mono, fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
    textTransform: 'uppercase', color, marginBottom: 8,
  });
  const itemStyle = {
    fontFamily: mono, fontSize: 10, color: 'var(--dl-middle)', lineHeight: '1.8',
  };
  const connectorStyle = {
    fontFamily: mono, fontSize: 11, color: 'var(--dl-border2)',
    textAlign: 'center', padding: '4px 0', letterSpacing: '0.1em',
    lineHeight: '1.4',
  };

  const cat = arch.client.libraryCategories || {};
  const features = arch.client.features || [];

  // Group routes by base path for concise display
  const routeGroups = {};
  for (const r of arch.apiRoutes) {
    const base = r.path.split('/').slice(0, 3).join('/');
    if (!routeGroups[base]) routeGroups[base] = { methods: new Set(), services: new Set() };
    r.methods.forEach(m => routeGroups[base].methods.add(m));
    r.services.forEach(s => routeGroups[base].services.add(s));
  }
  const topRoutes = Object.entries(routeGroups)
    .sort((a, b) => b[1].services.size - a[1].services.size)
    .slice(0, 10);

  const svcEntries = Object.entries(arch.services || {});

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      <div style={SECTION_LABEL}>Architecture (auto-generated)</div>

      {/* Client layer */}
      <div style={box('var(--dl-accent)')}>
        <div style={headingStyle('var(--dl-accent)')}>Client (Browser / Electron)</div>
        <div style={itemStyle}>
          {arch.client.framework}<br/>
          {(cat.editor || []).length > 0 && <>Tiptap Editor ({cat.editor.length} extensions)<br/></>}
          {(cat['3d'] || []).length > 0 && <>Three.js + R3F + postprocessing<br/></>}
          {(cat.auth_db || []).length > 0 && <>Supabase JS client (auth, realtime)<br/></>}
          {(cat.maps || []).length > 0 && <>Leaflet + react-leaflet (2D maps)<br/></>}
          {(cat.dnd || []).length > 0 && <>@dnd-kit (drag and drop)<br/></>}
          {(cat.state || []).length > 0 && <>State: {cat.state.join(', ')}<br/></>}
          {(cat.payments || []).length > 0 && <>Payments: Stripe<br/></>}
          {features.length > 0 && <>Browser APIs: {features.join(', ')}</>}
        </div>
      </div>

      <div style={connectorStyle}>{'│'}<br/>{'API Routes (' + arch.apiRoutes.length + ')'}<br/>{'▼'}</div>

      {/* Server layer */}
      <div style={box('#6BAED6')}>
        <div style={headingStyle('#6BAED6')}>Server (Vercel Edge / Serverless)</div>
        <div style={itemStyle}>
          {topRoutes.map(([base, info]) => (
            <span key={base}>
              {base} [{[...info.methods].join(',')}]
              {info.services.size > 0 && <span style={{ color: 'var(--dl-border2)' }}> → {[...info.services].join(', ')}</span>}
              <br/>
            </span>
          ))}
          {Object.keys(routeGroups).length > 10 && (
            <span style={{ color: 'var(--dl-border2)' }}>...and {Object.keys(routeGroups).length - 10} more route groups</span>
          )}
        </div>
      </div>

      <div style={connectorStyle}>
        {'│'}<br/>
        {'┌' + svcEntries.map(() => '──────').join('┬') + '┐'}<br/>
        {svcEntries.map(() => '▼     ').join(' ')}
      </div>

      {/* External services */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {svcEntries.map(([key, svc]) => {
          const color = SVC_COLORS[key] || 'var(--dl-middle)';
          return (
            <div key={key} style={{
              border: `1px solid ${color}44`, borderRadius: 8, padding: '8px 12px',
              background: color + '08', flex: '1 1 0', minWidth: 100,
            }}>
              <div style={{ fontFamily: mono, fontSize: 10, fontWeight: 600, color, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                {key}
              </div>
              {svc.model && (
                <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-accent)', marginTop: 2 }}>{svc.model}</div>
              )}
              {svc.tables && (
                <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)', marginTop: 2 }}>
                  {svc.tables.length} tables
                </div>
              )}
              {svc.usedBy && (
                <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)', marginTop: 2 }}>
                  {svc.usedBy.length} routes
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Supabase tables detail */}
      {arch.services?.supabase?.tables?.length > 0 && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: '#3ECF8E08', border: '1px solid #3ECF8E22' }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#3ECF8E', marginBottom: 6 }}>
            Supabase Tables ({arch.services.supabase.tables.length})
          </div>
          <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-middle)', lineHeight: '1.8', columnCount: 2, columnGap: 16 }}>
            {arch.services.supabase.tables.map(t => <span key={t}>{t}<br/></span>)}
          </div>
        </div>
      )}

      {/* Data collected */}
      {arch.dataCollected?.length > 0 && (
        <div style={{ marginTop: 10, padding: '10px 14px', borderRadius: 8, background: 'var(--dl-border-15, rgba(128,120,100,0.06))' }}>
          <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--dl-middle)', marginBottom: 6 }}>Data Collected</div>
          <div style={{ fontFamily: mono, fontSize: 9, color: 'var(--dl-border2)', lineHeight: '1.8' }}>
            {arch.dataCollected.join(' · ')}
          </div>
        </div>
      )}

      {/* Generated timestamp */}
      <div style={{ fontFamily: mono, fontSize: 8, color: 'var(--dl-border2)', marginTop: 8, textAlign: 'right' }}>
        Auto-generated {new Date(arch.generatedAt).toLocaleDateString()} {new Date(arch.generatedAt).toLocaleTimeString()}
      </div>
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

      {/* Architecture */}
      <div style={{
        background: 'var(--dl-card)', border: '1px solid var(--dl-border)',
        borderRadius: 12, padding: 16,
      }}>
        <ArchDiagram arch={arch} />
      </div>

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
