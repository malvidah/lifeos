'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase.js';

const mono = "'SF Mono', 'Monaco', 'Inconsolata', monospace";
const serif = "Georgia, 'Times New Roman', serif";
const bg = '#0A0A0A';
const text = '#f0ece4';
const muted = '#666';
const accent = '#c4a882';
const border = '#2a2a2e';
const surface = '#141416';

const FEATURES = [
  { label: 'Daily AI insights from your Oura data', premium: true },
  { label: 'Unlimited conversational chat', premium: true },
  { label: 'Year-over-year trend analysis', premium: true },
  { label: 'Voice entry & smart data parsing', premium: false },
  { label: 'Calorie & protein estimation', premium: false },
  { label: 'Oura + Strava sync', premium: false },
];

function UpgradeContent() {
  const params = useSearchParams();
  const success = params.get('success') === 'true';
  const [plan, setPlan] = useState('yearly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [session, setSession] = useState(null);
  const [checking, setChecking] = useState(success);
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
  }, []);

  // Poll for premium activation after payment
  useEffect(() => {
    if (!success || !session) return;
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const supabase = createClient();
        const { data } = await supabase.from('entries').select('data')
          .eq('type', 'premium').eq('date', 'global').eq('user_id', session.user.id).maybeSingle();
        if (data?.data?.active) { setIsPremium(true); setChecking(false); clearInterval(poll); }
      } catch {}
      if (attempts >= 12) { setChecking(false); clearInterval(poll); }
    }, 1500);
    return () => clearInterval(poll);
  }, [success, session]);

  async function handleUpgrade() {
    if (!session) { window.location.href = '/'; return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else setError(data.error || 'Something went wrong');
    } catch (e) { setError(e.message); }
    setLoading(false);
  }

  if (success) {
    return (
      <div style={{ textAlign: 'center', padding: '80px 24px', maxWidth: 480, margin: '0 auto' }}>
        {checking ? (
          <>
            <div style={{ width: 40, height: 40, borderRadius: '50%', border: `1px solid ${border}`, borderTopColor: accent, margin: '0 auto 24px', animation: 'spin 1s linear infinite' }}/>
            <p style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Activating your account…</p>
          </>
        ) : isPremium ? (
          <>
            <div style={{ fontSize: 28, marginBottom: 20, color: accent }}>✦</div>
            <h1 style={{ fontFamily: serif, fontSize: 30, color: text, fontWeight: 400, margin: '0 0 12px', letterSpacing: '-0.02em' }}>You're all set</h1>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 48px' }}>
              AI insights and unlimited chat are now unlocked.<br/>Head back to your dashboard to see them in action.
            </p>
            <a href="/" style={{
              display: 'inline-block', fontFamily: mono, fontSize: 10, letterSpacing: '0.15em',
              textTransform: 'uppercase', color: bg, textDecoration: 'none',
              background: accent, padding: '12px 28px', borderRadius: 8,
            }}>Go to Dashboard →</a>
          </>
        ) : (
          <>
            <h1 style={{ fontFamily: serif, fontSize: 28, color: text, fontWeight: 400, margin: '0 0 12px' }}>Payment received</h1>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 40px' }}>
              Your account will be upgraded within a minute.<br/>Refresh the dashboard if insights are still locked.
            </p>
            <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, textDecoration: 'none' }}>Back to Dashboard →</a>
          </>
        )}
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  const monthlyPrice = '$4.99';
  const yearlyPrice = '$39.99';
  const yearlyMonthly = '$3.33';
  const savings = 'Save 33%';

  return (
    <div style={{ padding: '60px 24px 80px', maxWidth: 480, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 48 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, color: muted, letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Loop</a>
        <h1 style={{ fontFamily: serif, fontSize: 38, color: text, margin: '16px 0 10px', letterSpacing: '-0.02em', fontWeight: 400 }}>Premium</h1>
        <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: 0 }}>
          AI that knows your body,<br/>your patterns, and your day.
        </p>
      </div>

      {/* Plan toggle */}
      <div style={{
        display: 'flex', background: surface, borderRadius: 10,
        border: `1px solid ${border}`, padding: 4, marginBottom: 28, position: 'relative',
      }}>
        {['monthly', 'yearly'].map(p => (
          <button key={p} onClick={() => setPlan(p)} style={{
            flex: 1, padding: '10px 0', border: 'none', borderRadius: 7, cursor: 'pointer',
            fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            background: plan === p ? accent : 'transparent',
            color: plan === p ? bg : muted,
            transition: 'all 0.2s', position: 'relative',
          }}>
            {p}
            {p === 'yearly' && (
              <span style={{
                position: 'absolute', top: -9, right: 10,
                background: '#3a7a4a', color: '#a8e6b8',
                fontFamily: mono, fontSize: 7, letterSpacing: '0.1em',
                padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
              }}>{savings}</span>
            )}
          </button>
        ))}
      </div>

      {/* Price display */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 2 }}>
          <span style={{ fontFamily: mono, fontSize: 16, color: muted, marginTop: 10 }}>$</span>
          <span style={{ fontFamily: serif, fontSize: 56, color: text, lineHeight: 1, letterSpacing: '-0.03em' }}>
            {plan === 'yearly' ? '39' : '4'}
          </span>
          <span style={{ fontFamily: mono, fontSize: 16, color: muted, marginTop: 10 }}>
            {plan === 'yearly' ? '.99' : '.99'}
          </span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: muted, marginTop: 6, letterSpacing: '0.08em' }}>
          {plan === 'yearly' ? `per year — ${yearlyMonthly}/mo` : 'per month'}
        </div>
      </div>

      {/* Features */}
      <div style={{
        background: surface, borderRadius: 12, border: `1px solid ${border}`,
        padding: '20px 24px', marginBottom: 28,
      }}>
        {FEATURES.map((f, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '8px 0',
            borderBottom: i < FEATURES.length - 1 ? `1px solid ${border}` : 'none',
          }}>
            <span style={{ fontSize: 11, color: f.premium ? accent : '#3a7a4a', flexShrink: 0 }}>
              {f.premium ? '✦' : '✓'}
            </span>
            <span style={{ fontFamily: mono, fontSize: 10, color: f.premium ? text : muted, letterSpacing: '0.04em', lineHeight: 1.5 }}>
              {f.label}
            </span>
            {!f.premium && (
              <span style={{ fontFamily: mono, fontSize: 8, color: muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginLeft: 'auto', flexShrink: 0 }}>free</span>
            )}
          </div>
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={handleUpgrade}
        disabled={loading}
        style={{
          width: '100%', background: accent, border: 'none', borderRadius: 10,
          color: bg, fontFamily: mono, fontSize: 11, letterSpacing: '0.15em',
          textTransform: 'uppercase', padding: '16px 0',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s',
          marginBottom: 12,
        }}>
        {loading ? 'Redirecting…' : `Get Premium — ${plan === 'yearly' ? yearlyPrice + '/yr' : monthlyPrice + '/mo'}`}
      </button>

      <p style={{ fontFamily: mono, fontSize: 9, color: muted, textAlign: 'center', margin: '0 0 4px', letterSpacing: '0.05em' }}>
        Have a discount code? Enter it on the next screen.
      </p>
      <p style={{ fontFamily: mono, fontSize: 9, color: muted, textAlign: 'center', margin: 0, letterSpacing: '0.05em' }}>
        Cancel anytime. Powered by Stripe.
      </p>

      {error && <p style={{ fontFamily: mono, fontSize: 10, color: '#e06c6c', textAlign: 'center', marginTop: 16 }}>{error}</p>}

      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, textDecoration: 'none' }}>← Back to dashboard</a>
      </div>
    </div>
  );
}

export default function UpgradePage() {
  return (
    <div style={{ background: bg, minHeight: '100vh', color: text }}>
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <span style={{ fontFamily: "'SF Mono', monospace", fontSize: 9, color: muted, letterSpacing: '0.15em' }}>LOADING…</span>
        </div>
      }>
        <UpgradeContent />
      </Suspense>
    </div>
  );
}
