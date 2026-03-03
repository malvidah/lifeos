'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase.js';
import { loadStripe } from '@stripe/stripe-js';

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

function SuccessView({ session }) {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [state, setState] = useState('activating'); // activating | active | slow

  useEffect(() => {
    if (!session || !sessionId) { setState('slow'); return; }

    // Try fallback grant first (ensures premium is set even if webhook was slow)
    fetch('/api/stripe/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});

    // Poll DB until premium row appears
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const supabase = createClient();
        const { data } = await supabase.from('entries').select('data')
          .eq('type', 'premium').eq('date', 'global').eq('user_id', session.user.id).maybeSingle();
        if (data?.data?.active) { setState('active'); clearInterval(poll); }
      } catch {}
      if (attempts >= 10) { setState('slow'); clearInterval(poll); }
    }, 1200);
    return () => clearInterval(poll);
  }, [session, sessionId]);

  return (
    <div style={{ textAlign: 'center', padding: '80px 24px', maxWidth: 480, margin: '0 auto' }}>
      {state === 'activating' && (
        <>
          <div style={{ width: 36, height: 36, borderRadius: '50%', border: `1.5px solid ${border}`, borderTopColor: accent, margin: '0 auto 24px', animation: 'spin 1s linear infinite' }}/>
          <p style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Activating your account…</p>
        </>
      )}
      {state === 'active' && (
        <>
          <div style={{ fontFamily: serif, fontSize: 42, color: accent, marginBottom: 20 }}>✦</div>
          <h1 style={{ fontFamily: serif, fontSize: 32, color: text, fontWeight: 400, margin: '0 0 14px', letterSpacing: '-0.02em' }}>You're all set</h1>
          <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 48px' }}>
            AI insights and unlimited chat are now unlocked.
          </p>
          <a href="/" style={{
            display: 'inline-block', fontFamily: mono, fontSize: 10, letterSpacing: '0.15em',
            textTransform: 'uppercase', color: bg, textDecoration: 'none',
            background: accent, padding: '13px 32px', borderRadius: 8,
          }}>Go to Dashboard →</a>
        </>
      )}
      {state === 'slow' && (
        <>
          <div style={{ fontFamily: serif, fontSize: 42, color: accent, marginBottom: 20 }}>✦</div>
          <h1 style={{ fontFamily: serif, fontSize: 28, color: text, fontWeight: 400, margin: '0 0 12px' }}>Payment received</h1>
          <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 40px' }}>
            Your account is being activated — it may take a minute to reflect.<br/>
            Refresh the dashboard and your insights should be unlocked.
          </p>
          <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, textDecoration: 'none', border: `1px solid ${accent}40`, padding: '10px 24px', borderRadius: 8 }}>
            Go to Dashboard →
          </a>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function PricingView({ session, onStartCheckout }) {
  const [plan, setPlan] = useState('yearly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
      if (data.clientSecret) {
        onStartCheckout(data.clientSecret);
      } else {
        setError(data.error || 'Something went wrong');
        setLoading(false);
      }
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '60px 24px 80px', maxWidth: 440, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 44 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, color: muted, letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Loop</a>
        <h1 style={{ fontFamily: serif, fontSize: 38, color: text, margin: '16px 0 10px', letterSpacing: '-0.02em', fontWeight: 400 }}>Premium</h1>
        <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: 0 }}>
          AI that knows your body,<br/>your patterns, and your day.
        </p>
      </div>

      {/* Plan toggle */}
      <div style={{ display: 'flex', background: surface, borderRadius: 10, border: `1px solid ${border}`, padding: 4, marginBottom: 28 }}>
        {['monthly', 'yearly'].map(p => (
          <button key={p} onClick={() => setPlan(p)} style={{
            flex: 1, padding: '10px 0', border: 'none', borderRadius: 7, cursor: 'pointer',
            fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
            background: plan === p ? accent : 'transparent',
            color: plan === p ? bg : muted,
            transition: 'all 0.18s', position: 'relative',
          }}>
            {p}
            {p === 'yearly' && (
              <span style={{
                position: 'absolute', top: -9, right: 8,
                background: '#2a4a35', color: '#7dba94',
                fontFamily: mono, fontSize: 7, letterSpacing: '0.08em',
                padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase',
              }}>Save 20%</span>
            )}
          </button>
        ))}
      </div>

      {/* Price */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 2 }}>
          <span style={{ fontFamily: mono, fontSize: 15, color: muted, marginTop: 12 }}>$</span>
          <span style={{ fontFamily: serif, fontSize: 60, color: text, lineHeight: 1, letterSpacing: '-0.03em' }}>
            {plan === 'yearly' ? '48' : '5'}
          </span>
          <span style={{ fontFamily: mono, fontSize: 15, color: muted, marginTop: 12 }}>{plan === 'yearly' ? '' : ''}</span>
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: muted, marginTop: 6, letterSpacing: '0.06em' }}>
          {plan === 'yearly' ? 'per year · $4/mo' : 'per month'}
        </div>
      </div>

      {/* Features */}
      <div style={{ background: surface, borderRadius: 12, border: `1px solid ${border}`, padding: '4px 24px', marginBottom: 28 }}>
        {FEATURES.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < FEATURES.length - 1 ? `1px solid ${border}` : 'none' }}>
            <span style={{ fontSize: 11, color: f.premium ? accent : '#5a9a6a', flexShrink: 0 }}>{f.premium ? '✦' : '✓'}</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: f.premium ? text : muted, letterSpacing: '0.04em' }}>{f.label}</span>
            {!f.premium && <span style={{ fontFamily: mono, fontSize: 8, color: muted, letterSpacing: '0.1em', textTransform: 'uppercase', marginLeft: 'auto', flexShrink: 0 }}>free</span>}
          </div>
        ))}
      </div>

      <button onClick={handleUpgrade} disabled={loading} style={{
        width: '100%', background: accent, border: 'none', borderRadius: 10,
        color: bg, fontFamily: mono, fontSize: 11, letterSpacing: '0.15em',
        textTransform: 'uppercase', padding: '16px 0',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s', marginBottom: 12,
      }}>
        {loading ? 'Loading…' : `Get Premium — ${plan === 'yearly' ? '$48/yr' : '$5/mo'}`}
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

function CheckoutView({ clientSecret, onCancel }) {
  const containerRef = useRef(null);
  const checkoutRef = useRef(null);

  useEffect(() => {
    if (!clientSecret || !containerRef.current) return;
    let mounted = true;

    loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY).then(stripe => {
      if (!mounted || !stripe) return;
      stripe.initEmbeddedCheckout({ clientSecret }).then(checkout => {
        if (!mounted) { checkout.destroy(); return; }
        checkoutRef.current = checkout;
        checkout.mount(containerRef.current);
      });
    });

    return () => {
      mounted = false;
      checkoutRef.current?.destroy();
    };
  }, [clientSecret]);

  return (
    <div style={{ maxWidth: 480, margin: '0 auto', padding: '40px 24px 80px' }}>
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, color: muted, letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Loop</a>
        <h1 style={{ fontFamily: serif, fontSize: 28, color: text, margin: '14px 0 0', letterSpacing: '-0.02em', fontWeight: 400 }}>Complete your order</h1>
      </div>
      <div ref={containerRef} style={{ borderRadius: 12, overflow: 'hidden' }} />
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button onClick={onCancel} style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
      </div>
    </div>
  );
}

function UpgradeContent() {
  const params = useSearchParams();
  const success = params.get('success') === 'true';
  const [session, setSession] = useState(null);
  const [checkoutSecret, setCheckoutSecret] = useState(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
  }, []);

  if (success) return <SuccessView session={session} />;
  if (checkoutSecret) return <CheckoutView clientSecret={checkoutSecret} onCancel={() => setCheckoutSecret(null)} />;
  return <PricingView session={session} onStartCheckout={setCheckoutSecret} />;
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
