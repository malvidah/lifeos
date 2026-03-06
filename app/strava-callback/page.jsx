'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { createClient } from '../../lib/supabase.js';

const mono = "'SF Mono','Monaco','Inconsolata',monospace";
const serif = "'Playfair Display','Georgia',serif";
const bg = '#0A0A0A';
const text = '#f0ece4';
const muted = '#9A9088';
const dim = '#6A6258';
const accent = '#D08828';
const green = '#6abf7b';
const red = '#e06c6c';
const surface = '#141210';
const border = '#2a2520';

function CallbackContent() {
  const params = useSearchParams();
  const [status, setStatus] = useState('connecting');  // connecting | success | error
  const [message, setMessage] = useState('');
  const [athlete, setAthlete] = useState('');

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');

    if (error) { setStatus('error'); setMessage('Authorisation was denied.'); return; }
    if (!code) { setStatus('error'); setMessage('No authorisation code received.'); return; }

    const supabase = createClient();
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) { setStatus('error'); setMessage('Not signed in — please go back and try again.'); return; }

      const res = await fetch('/api/strava-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();

      if (!res.ok || data.error) {
        setStatus('error');
        setMessage(data.error || 'Unknown error');
      } else {
        setAthlete(data.athlete || '');
        setStatus('success');
        setMessage('Syncing your activity history…');
        fetch('/api/strava-backfill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({}),
        }).then(r => r.json()).then(() => {
          setMessage('All done. Redirecting…');
        }).catch(() => {});
        setTimeout(() => window.location.href = '/', 3000);
      }
    });
  }, []);

  return (
    <div style={{ background: bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 360, textAlign: 'center' }}>

        {/* Icon */}
        <div style={{ marginBottom: 28 }}>
          {status === 'connecting' && (
            <div style={{
              width: 40, height: 40, borderRadius: '50%',
              border: `2px solid ${border}`, borderTopColor: accent,
              margin: '0 auto',
              animation: 'spin 0.9s linear infinite'
            }}/>
          )}
          {status === 'success' && (
            <div style={{ fontSize: 36, color: green }}>✓</div>
          )}
          {status === 'error' && (
            <div style={{ fontSize: 36, color: red }}>✕</div>
          )}
        </div>

        {/* Heading */}
        <h1 style={{
          fontFamily: serif, fontSize: 28, fontWeight: 400,
          color: status === 'error' ? red : status === 'success' ? text : muted,
          margin: '0 0 12px', letterSpacing: '-0.01em',
        }}>
          {status === 'connecting' && 'Connecting Strava'}
          {status === 'success' && (athlete ? `Welcome, ${athlete}` : 'Strava Connected')}
          {status === 'error' && 'Connection Failed'}
        </h1>

        {/* Message */}
        <p style={{
          fontFamily: mono, fontSize: 11, color: status === 'error' ? red : dim,
          lineHeight: 1.7, margin: '0 0 32px', letterSpacing: '0.02em',
        }}>
          {status === 'connecting' ? 'Exchanging tokens with Strava…' : message}
        </p>

        {/* Back link */}
        {(status === 'success' || status === 'error') && (
          <a href="/" style={{
            display: 'inline-block',
            fontFamily: mono, fontSize: 9, letterSpacing: '0.15em',
            textTransform: 'uppercase', color: accent, textDecoration: 'none',
            border: `1px solid ${border}`, borderRadius: 6,
            padding: '8px 16px',
          }}>
            ← Back to Dashboard
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
