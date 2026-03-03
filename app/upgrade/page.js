'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase.js';

const mono = "'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace";
const serif = "Georgia, 'Times New Roman', serif";

function UpgradeContent() {
  const params = useSearchParams();
  const success = params.get('success') === 'true';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [checkingPremium, setCheckingPremium] = useState(success);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
  }, []);

  // After successful payment, poll briefly to confirm premium activated
  useEffect(() => {
    if (!success || !session) return;
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const supabase = createClient();
        const { data } = await supabase.from('entries').select('data')
          .eq('type', 'premium').eq('date', 'global').eq('user_id', session.user.id).maybeSingle();
        if (data?.data?.active) {
          setIsPremium(true);
          setCheckingPremium(false);
          clearInterval(poll);
        }
      } catch {}
      if (attempts >= 10) { setCheckingPremium(false); clearInterval(poll); }
    }, 1500);
    return () => clearInterval(poll);
  }, [success, session]);

  async function handleUpgrade() {
    if (!session) { window.location.href = '/'; return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error || 'Something went wrong');
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  const bg = '#0A0A0A';
  const text = '#f0ece4';
  const muted = '#666';
  const accent = '#c4a882';
  const border = '#2a2a2e';

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 24px', maxWidth: 480, margin: '0 auto' }}>
        {checkingPremium ? (
          <>
            <div style={{ fontSize: 24, marginBottom: 16 }}>⏳</div>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, letterSpacing: '0.1em' }}>Activating your account…</p>
          </>
        ) : isPremium ? (
          <>
            <div style={{ fontSize: 32, marginBottom: 16 }}>✦</div>
            <h1 style={{ fontFamily: serif, fontSize: 28, color: text, fontWeight: 400, margin: '0 0 12px', letterSpacing: '-0.02em' }}>Welcome to Premium</h1>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.7, margin: '0 0 40px' }}>
              AI insights and unlimited chat are now unlocked.
            </p>
            <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, textDecoration: 'none', border: `1px solid ${accent}`, padding: '10px 24px', borderRadius: 6 }}>
              Go to Dashboard →
            </a>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: serif, fontSize: 28, color: text, fontWeight: 400, margin: '0 0 12px' }}>Payment received</h1>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.7, margin: '0 0 40px' }}>
              Your account will be upgraded within a minute.<br/>Refresh the dashboard if insights are still locked.
            </p>
            <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, textDecoration: 'none' }}>
              Back to Dashboard →
            </a>
          </>
        )}
      </div>
    );
  }

  return (
    <div style={{ textAlign: 'center', padding: '60px 24px', maxWidth: 440, margin: '0 auto' }}>
      <div style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.2em', color: muted, textTransform: 'uppercase', marginBottom: 20 }}>Day Loop</div>
      <h1 style={{ fontFamily: serif, fontSize: 36, color: text, margin: '0 0 12px', letterSpacing: '-0.02em', fontWeight: 400 }}>Premium</h1>
      <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 48px' }}>
        AI-generated daily insights based on your sleep,<br/>
        readiness, and activity data. Unlimited chat<br/>
        with your personal wellness coach.
      </p>

      {/* Feature list */}
      <div style={{ textAlign: 'left', marginBottom: 40, display: 'inline-block' }}>
        {[
          '✦  Daily AI insights from your Oura data',
          '✦  Unlimited conversational chat',
          '✦  Year-over-year trend analysis',
          '✦  Voice entry and smart parsing (free)',
          '✦  Calorie & protein estimation (free)',
        ].map(f => (
          <div key={f} style={{ fontFamily: mono, fontSize: 10, color: f.includes('(free)') ? muted : text, letterSpacing: '0.04em', marginBottom: 10 }}>{f}</div>
        ))}
      </div>

      <div style={{ marginBottom: 12 }}>
        <button
          onClick={handleUpgrade}
          disabled={loading}
          style={{
            width: '100%', maxWidth: 320,
            background: accent, border: 'none', borderRadius: 8,
            color: '#0A0A0A', fontFamily: mono, fontSize: 10, letterSpacing: '0.15em',
            textTransform: 'uppercase', padding: '14px 32px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
          }}>
          {loading ? 'Redirecting…' : 'Upgrade — $4.99'}
        </button>
      </div>

      <p style={{ fontFamily: mono, fontSize: 9, color: muted, margin: '0 0 4px', letterSpacing: '0.05em' }}>
        Have a discount code? Enter it on the next screen.
      </p>

      {error && <p style={{ fontFamily: mono, fontSize: 10, color: '#e06c6c', marginTop: 12 }}>{error}</p>}

      <div style={{ marginTop: 48 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, textDecoration: 'none' }}>← Back to dashboard</a>
      </div>
    </div>
  );
}

export default function UpgradePage() {
  const bg = '#0A0A0A';
  return (
    <div style={{ background: bg, minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f0ece4' }}>
      <Suspense fallback={<div style={{ fontFamily: "'SF Mono', monospace", fontSize: 9, color: '#666' }}>loading…</div>}>
        <UpgradeContent />
      </Suspense>
    </div>
  );
}
