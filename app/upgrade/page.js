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
const red = '#b04840';
const green = '#4a9a68';

const FEATURES = [
  { label: 'Unlimited AI insights from your health data', premium: true },
  { label: 'Voice entry & smart data parsing',           premium: true },
  { label: 'Conversational chat with your data',         premium: true },
  { label: 'Year-over-year trend analysis',              premium: true },
  { label: 'Oura + Strava + Apple Health sync',          premium: false },
  { label: 'Calorie & protein estimation',               premium: false },
  { label: 'Calendar, tasks, meals, journal',            premium: false },
];

// ── Success view (post-checkout) ─────────────────────────────────────────────
function SuccessView({ session }) {
  const params = useSearchParams();
  const sessionId = params.get('session_id');
  const [state, setState] = useState('activating');

  useEffect(() => {
    if (!session || !sessionId) { setState('slow'); return; }
    fetch('/api/stripe/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});

    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const sb = createClient();
        const { data } = await sb.from('entries').select('data')
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
          <div style={{ fontFamily: serif, fontSize: 48, color: accent, marginBottom: 20 }}>✦</div>
          <h1 style={{ fontFamily: serif, fontSize: 32, color: text, fontWeight: 400, margin: '0 0 14px', letterSpacing: '-0.02em' }}>You're all set</h1>
          <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 48px' }}>
            Unlimited AI insights, voice entry, and chat are now unlocked.
          </p>
          <a href="/" style={{ display: 'inline-block', fontFamily: mono, fontSize: 10, letterSpacing: '0.15em', textTransform: 'uppercase', color: bg, textDecoration: 'none', background: accent, padding: '13px 32px', borderRadius: 8 }}>Go to Dashboard →</a>
        </>
      )}
      {state === 'slow' && (
        <>
          <div style={{ fontFamily: serif, fontSize: 48, color: accent, marginBottom: 20 }}>✦</div>
          <h1 style={{ fontFamily: serif, fontSize: 28, color: text, fontWeight: 400, margin: '0 0 12px' }}>Payment received</h1>
          <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 40px' }}>
            Your account is being activated — it may take a minute.<br/>Refresh the dashboard and your features should be unlocked.
          </p>
          <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.15em', textTransform: 'uppercase', color: accent, textDecoration: 'none', border: `1px solid ${accent}40`, padding: '10px 24px', borderRadius: 8 }}>Go to Dashboard →</a>
        </>
      )}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Manage plan view (already premium) ───────────────────────────────────────
function ManageView({ session, premiumData }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const params = useSearchParams();
  const fromPortal = params.get('from') === 'portal';

  const plan = premiumData?.plan;
  const grantedAt = premiumData?.grantedAt ? new Date(premiumData.grantedAt) : null;

  async function openPortal() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || 'Could not open billing portal');
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
        <a href="/" style={{ fontFamily: mono, fontSize: 9, color: muted, letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Lab</a>
        <div style={{ fontFamily: serif, fontSize: 40, color: accent, margin: '16px 0 8px' }}>✦</div>
        <h1 style={{ fontFamily: serif, fontSize: 34, color: text, margin: '0 0 10px', letterSpacing: '-0.02em', fontWeight: 400 }}>Premium</h1>
        <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: 0 }}>
          Your account is active
        </p>
      </div>

      {fromPortal && (
        <div style={{ background: `${green}15`, border: `1px solid ${green}40`, borderRadius: 10, padding: '12px 16px', marginBottom: 24, fontFamily: mono, fontSize: 10, color: green, letterSpacing: '0.04em' }}>
          ✓ Your billing changes have been saved.
        </div>
      )}

      {/* Plan details */}
      <div style={{ background: surface, borderRadius: 12, border: `1px solid ${border}`, padding: '20px 24px', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div>
            <div style={{ fontFamily: mono, fontSize: 11, color: text, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
              {plan === 'yearly' ? 'Annual Plan' : 'Monthly Plan'}
            </div>
            <div style={{ fontFamily: mono, fontSize: 10, color: muted }}>
              {plan === 'yearly' ? '$48 / year · $4/mo' : '$5 / month'}
            </div>
          </div>
          <div style={{ background: `${accent}20`, border: `1px solid ${accent}40`, borderRadius: 6, padding: '4px 10px', fontFamily: mono, fontSize: 9, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            Active
          </div>
        </div>
        {grantedAt && (
          <div style={{ fontFamily: mono, fontSize: 9, color: muted, borderTop: `1px solid ${border}`, paddingTop: 12, letterSpacing: '0.04em' }}>
            Member since {grantedAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
          </div>
        )}
      </div>

      {/* Features */}
      <div style={{ background: surface, borderRadius: 12, border: `1px solid ${border}`, padding: '4px 24px', marginBottom: 28 }}>
        {FEATURES.filter(f => f.premium).map((f, i, arr) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: i < arr.length - 1 ? `1px solid ${border}` : 'none' }}>
            <span style={{ fontSize: 10, color: accent, flexShrink: 0 }}>✦</span>
            <span style={{ fontFamily: mono, fontSize: 10, color: text, letterSpacing: '0.04em' }}>{f.label}</span>
          </div>
        ))}
      </div>

      {/* Manage button */}
      <button onClick={openPortal} disabled={loading} style={{
        width: '100%', background: 'none', border: `1px solid ${border}`, borderRadius: 10,
        color: muted, fontFamily: mono, fontSize: 11, letterSpacing: '0.12em',
        textTransform: 'uppercase', padding: '14px 0',
        cursor: loading ? 'not-allowed' : 'pointer',
        opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s, border-color 0.15s',
        marginBottom: 10,
      }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = muted; e.currentTarget.style.color = text; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = border; e.currentTarget.style.color = muted; }}>
        {loading ? 'Opening billing portal…' : 'Manage Billing & Plan'}
      </button>

      <p style={{ fontFamily: mono, fontSize: 9, color: muted, textAlign: 'center', margin: '0 0 4px', letterSpacing: '0.05em' }}>
        Change plan, update payment method, or cancel anytime.
      </p>

      {error && <p style={{ fontFamily: mono, fontSize: 10, color: red, textAlign: 'center', marginTop: 14 }}>{error}</p>}

      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, textDecoration: 'none' }}>← Back to dashboard</a>
      </div>
    </div>
  );
}

// ── Pricing / checkout view (free user) ──────────────────────────────────────
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
        <a href="/" style={{ fontFamily: mono, fontSize: 9, color: muted, letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Lab</a>
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
              <span style={{ position: 'absolute', top: -9, right: 8, background: '#2a4a35', color: '#7dba94', fontFamily: mono, fontSize: 7, letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 4, textTransform: 'uppercase' }}>Save 20%</span>
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
        </div>
        <div style={{ fontFamily: mono, fontSize: 10, color: muted, marginTop: 6, letterSpacing: '0.06em' }}>
          {plan === 'yearly' ? 'per year · $4/mo' : 'per month'}
        </div>
      </div>

      {/* Features */}
      <div style={{ background: surface, borderRadius: 12, border: `1px solid ${border}`, padding: '4px 24px', marginBottom: 28 }}>
        {FEATURES.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 0', borderBottom: i < FEATURES.length - 1 ? `1px solid ${border}` : 'none' }}>
            <span style={{ fontSize: 11, color: f.premium ? accent : green, flexShrink: 0 }}>{f.premium ? '✦' : '✓'}</span>
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
      {error && <p style={{ fontFamily: mono, fontSize: 10, color: red, textAlign: 'center', marginTop: 16 }}>{error}</p>}

      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, textDecoration: 'none' }}>← Back to dashboard</a>
      </div>
    </div>
  );
}

// ── Embedded Stripe checkout ──────────────────────────────────────────────────
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
        <a href="/" style={{ fontFamily: mono, fontSize: 9, color: muted, letterSpacing: '0.18em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Lab</a>
        <h1 style={{ fontFamily: serif, fontSize: 28, color: text, margin: '14px 0 0', letterSpacing: '-0.02em', fontWeight: 400 }}>Complete your order</h1>
      </div>
      <div ref={containerRef} style={{ borderRadius: 12, overflow: 'hidden' }} />
      <div style={{ textAlign: 'center', marginTop: 20 }}>
        <button onClick={onCancel} style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: muted, background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
      </div>
    </div>
  );
}

// ── Root content (decides which view to show) ─────────────────────────────────
function UpgradeContent() {
  const params = useSearchParams();
  const success = params.get('success') === 'true';
  const [session, setSession] = useState(null);
  const [premiumData, setPremiumData] = useState(undefined); // undefined = loading
  const [checkoutSecret, setCheckoutSecret] = useState(null);

  useEffect(() => {
    const sb = createClient();
    sb.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s?.user) {
        sb.from('entries').select('data')
          .eq('type', 'premium').eq('date', 'global').eq('user_id', s.user.id)
          .maybeSingle()
          .then(({ data }) => setPremiumData(data?.data?.active ? data.data : null))
          .catch(() => setPremiumData(null));
      } else {
        setPremiumData(null);
      }
    });
  }, []);

  // Still loading
  if (premiumData === undefined && !success) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `1.5px solid ${border}`, borderTopColor: accent, animation: 'spin 1s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (success) return <SuccessView session={session} />;
  if (premiumData?.active) return <ManageView session={session} premiumData={premiumData} />;
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
