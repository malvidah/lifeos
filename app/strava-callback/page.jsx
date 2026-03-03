'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '../../lib/supabase.js';

function CallbackContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState('Connecting to Strava…');
  const [done, setDone] = useState(false);
  const [err, setErr] = useState(false);

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');
    if (error) { setStatus('Strava authorisation was denied.'); setErr(true); return; }
    if (!code) { setStatus('No authorisation code received.'); setErr(true); return; }

    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setStatus('Not signed in — please go back and try again.'); setErr(true); return; }

      const res = await fetch('/api/strava-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setStatus('Connection failed: ' + (data.error || 'unknown error'));
        setErr(true);
      } else {
        setStatus(data.athlete ? `Connected! Welcome, ${data.athlete}.` : 'Strava connected!');
        setDone(true);
        setTimeout(() => window.location.href = '/', 1800);
      }
    });
  }, []);

  const mono = "'SF Mono','Monaco','Inconsolata',monospace";
  const bg = '#0A0A0A';
  const text = '#f0ece4';
  const muted = '#666';
  const accent = '#c4a882';
  const green = '#6abf7b';

  return (
    <div style={{ background: bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ textAlign: 'center', maxWidth: 360 }}>
        {!done && !err && (
          <div style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid #2a2a2e`, borderTopColor: accent, margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}/>
        )}
        {done && <div style={{ fontSize: 28, marginBottom: 16 }}>✓</div>}
        {err && <div style={{ fontSize: 28, marginBottom: 16, color: '#e06c6c' }}>✕</div>}
        <p style={{ fontFamily: mono, fontSize: 11, color: err ? '#e06c6c' : done ? green : muted, lineHeight: 1.7 }}>{status}</p>
        {(done || err) && (
          <a href="/" style={{ display: 'inline-block', marginTop: 24, fontFamily: mono, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, textDecoration: 'none' }}>
            ← Back to dashboard
          </a>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}

export default function StravaCallback() {
  return (
    <Suspense fallback={<div style={{ background: '#0A0A0A', minHeight: '100vh' }}/>}>
      <CallbackContent />
    </Suspense>
  );
}
