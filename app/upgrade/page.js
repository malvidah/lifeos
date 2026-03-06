'use client';
import { useState, useEffect, useRef, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '../../lib/supabase.js';
import { loadStripe } from '@stripe/stripe-js';

// ── Exact dashboard tokens ────────────────────────────────────────────────────
const bg      = '#141412';
const surface = '#232220';
const well    = '#1A1918';
const border  = '#2C2A28';
const border2 = '#383532';
const text    = '#D8CEC2';
const muted   = '#9A9088';
const dim     = '#6A6258';
const accent  = '#D08828';
const green   = '#4A9A68';
const red     = '#B04840';
const mono    = "'SF Mono', 'Fira Code', ui-monospace, monospace";
const serif   = "Georgia, 'Times New Roman', serif";

const FEATURES = [
  { label: 'Unlimited AI insights from your health data', premium: true },
  { label: 'Voice entry & smart data parsing',           premium: true },
  { label: 'Conversational chat with your data',         premium: true },
  { label: 'Year-over-year trend analysis',              premium: true },
  { label: 'Oura + Strava + Apple Health sync',          premium: false },
  { label: 'Calorie & protein estimation',               premium: false },
  { label: 'Calendar, tasks, meals, journal',            premium: false },
];

function TopBar() {
  return (
    <div style={{ padding: '20px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${border}` }}>
      <a href="/" style={{ fontFamily: mono, fontSize: 11, color: dim, letterSpacing: '0.14em', textTransform: 'uppercase', textDecoration: 'none' }}>Day Lab</a>
      <a href="/" style={{ fontFamily: mono, fontSize: 10, color: dim, letterSpacing: '0.08em', textDecoration: 'none' }}>← Dashboard</a>
    </div>
  );
}

// ── Success view ──────────────────────────────────────────────────────────────
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
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        {state === 'activating' && (
          <>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${border2}`, borderTopColor: accent, margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}/>
            <p style={{ fontFamily: mono, fontSize: 10, color: dim, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Activating your account…</p>
          </>
        )}
        {state === 'active' && (
          <>
            <div style={{ fontFamily: serif, fontSize: 44, color: accent, marginBottom: 18 }}>✦</div>
            <h1 style={{ fontFamily: serif, fontSize: 30, color: text, fontWeight: 400, margin: '0 0 12px', letterSpacing: '-0.02em' }}>You're all set</h1>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 36px' }}>
              Unlimited AI insights, voice entry, and chat are now unlocked.
            </p>
            <a href="/" style={{ display: 'inline-block', fontFamily: mono, fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: bg, textDecoration: 'none', background: accent, padding: '12px 28px', borderRadius: 7 }}>Go to Dashboard →</a>
          </>
        )}
        {state === 'slow' && (
          <>
            <div style={{ fontFamily: serif, fontSize: 44, color: accent, marginBottom: 18 }}>✦</div>
            <h1 style={{ fontFamily: serif, fontSize: 26, color: text, fontWeight: 400, margin: '0 0 10px' }}>Payment received</h1>
            <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: '0 0 32px' }}>
              Your account is being activated — it may take a minute.<br/>Refresh the dashboard and your features should be unlocked.
            </p>
            <a href="/" style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: accent, textDecoration: 'none', border: `1px solid ${border2}`, padding: '10px 22px', borderRadius: 7 }}>Go to Dashboard →</a>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Embedded Stripe portal (for manage/cancel) ────────────────────────────────
function PortalView({ session, premiumData, onBack }) {
  const [portalUrl, setPortalUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const iframeRef = useRef(null);

  useEffect(() => {
    if (!session) return;
    fetch('/api/stripe/portal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
    })
      .then(r => r.json())
      .then(d => {
        if (d.url) setPortalUrl(d.url);
        else setError(d.error || 'Could not open billing portal');
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [session]);

  // Stripe portal can't be iframed (X-Frame-Options), so open in same tab
  // but styled as a transition from our UI
  useEffect(() => {
    if (portalUrl) window.location.href = portalUrl;
  }, [portalUrl]);

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ textAlign: 'center', maxWidth: 400 }}>
        {loading && !error && (
          <>
            <div style={{ width: 32, height: 32, borderRadius: '50%', border: `1.5px solid ${border2}`, borderTopColor: accent, margin: '0 auto 20px', animation: 'spin 1s linear infinite' }}/>
            <p style={{ fontFamily: mono, fontSize: 10, color: dim, letterSpacing: '0.12em', textTransform: 'uppercase' }}>Opening billing portal…</p>
          </>
        )}
        {error && (
          <>
            <p style={{ fontFamily: mono, fontSize: 11, color: red, marginBottom: 20 }}>{error}</p>
            <button onClick={onBack} style={{ fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: muted, background: 'none', border: `1px solid ${border2}`, borderRadius: 6, padding: '9px 20px', cursor: 'pointer' }}>← Back</button>
          </>
        )}
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Manage plan view ──────────────────────────────────────────────────────────
function ManageView({ session, premiumData, onManage }) {
  const params = useSearchParams();
  const fromPortal = params.get('from') === 'portal';
  const plan = premiumData?.plan;
  const grantedAt = premiumData?.grantedAt ? new Date(premiumData.grantedAt) : null;

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px 24px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {fromPortal && (
          <div style={{ background: `${green}18`, border: `1px solid ${green}40`, borderRadius: 8, padding: '11px 16px', marginBottom: 20, fontFamily: mono, fontSize: 10, color: green, letterSpacing: '0.04em' }}>
            ✓ Your billing changes have been saved.
          </div>
        )}

        {/* Plan card */}
        <div style={{ background: surface, borderRadius: 10, border: `1px solid ${border}`, overflow: 'hidden', marginBottom: 16 }}>
          <div style={{ padding: '20px 20px 18px', borderBottom: `1px solid ${border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: mono, fontSize: 10, color: accent, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Premium</span>
              <span style={{ color: accent, fontSize: 10 }}>✦</span>
              <span style={{ marginLeft: 'auto', background: `${accent}18`, border: `1px solid ${accent}30`, borderRadius: 4, padding: '2px 8px', fontFamily: mono, fontSize: 8, color: accent, letterSpacing: '0.08em', textTransform: 'uppercase' }}>Active</span>
            </div>
            <div style={{ fontFamily: mono, fontSize: 11, color: muted }}>
              {plan === 'yearly' ? 'Annual plan · $48/yr ($4/mo)' : 'Monthly plan · $5/mo'}
            </div>
            {grantedAt && (
              <div style={{ fontFamily: mono, fontSize: 10, color: dim, marginTop: 8 }}>
                Member since {grantedAt.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              </div>
            )}
          </div>

          {/* Included features */}
          <div style={{ padding: '4px 0' }}>
            {FEATURES.filter(f => f.premium).map((f, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 20px', borderBottom: i < FEATURES.filter(f=>f.premium).length - 1 ? `1px solid ${border}` : 'none' }}>
                <span style={{ color: accent, fontSize: 9, flexShrink: 0 }}>✦</span>
                <span style={{ fontFamily: mono, fontSize: 10, color: muted, letterSpacing: '0.03em' }}>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Manage button */}
        <button onClick={onManage} style={{
          width: '100%', background: 'none', border: `1px solid ${border2}`, borderRadius: 8,
          color: muted, fontFamily: mono, fontSize: 10, letterSpacing: '0.1em',
          textTransform: 'uppercase', padding: '13px 0', cursor: 'pointer', marginBottom: 10,
          transition: 'border-color 0.15s, color 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = muted; e.currentTarget.style.color = text; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = border2; e.currentTarget.style.color = muted; }}>
          Manage Billing & Plan →
        </button>
        <p style={{ fontFamily: mono, fontSize: 9, color: dim, textAlign: 'center', margin: 0, letterSpacing: '0.04em' }}>
          Change plan, update payment, or cancel anytime.
        </p>
      </div>
    </div>
  );
}

// ── Pricing view ──────────────────────────────────────────────────────────────
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
      if (data.clientSecret) onStartCheckout(data.clientSecret);
      else { setError(data.error || 'Something went wrong'); setLoading(false); }
    } catch (e) { setError(e.message); setLoading(false); }
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '32px 24px 48px' }}>
      <div style={{ width: '100%', maxWidth: 400 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <h1 style={{ fontFamily: serif, fontSize: 36, color: text, margin: '0 0 10px', letterSpacing: '-0.02em', fontWeight: 400 }}>Premium</h1>
          <p style={{ fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.8, margin: 0 }}>
            AI that knows your body,<br/>your patterns, and your day.
          </p>
        </div>

        {/* Toggle */}
        <div style={{ display: 'flex', background: well, borderRadius: 8, border: `1px solid ${border}`, padding: 3, marginBottom: 22 }}>
          {['monthly', 'yearly'].map(p => (
            <button key={p} onClick={() => setPlan(p)} style={{
              flex: 1, padding: '9px 0', border: 'none', borderRadius: 6, cursor: 'pointer',
              fontFamily: mono, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase',
              background: plan === p ? surface : 'transparent',
              color: plan === p ? text : dim,
              boxShadow: plan === p ? `0 1px 3px rgba(0,0,0,0.4)` : 'none',
              transition: 'all 0.15s', position: 'relative',
            }}>
              {p}
              {p === 'yearly' && (
                <span style={{ position: 'absolute', top: -8, right: 6, background: `${green}25`, border: `1px solid ${green}50`, color: green, fontFamily: mono, fontSize: 7, letterSpacing: '0.08em', padding: '2px 5px', borderRadius: 4, textTransform: 'uppercase' }}>Save 20%</span>
              )}
            </button>
          ))}
        </div>

        {/* Price */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gap: 2 }}>
            <span style={{ fontFamily: mono, fontSize: 14, color: dim, marginTop: 10 }}>$</span>
            <span style={{ fontFamily: serif, fontSize: 58, color: text, lineHeight: 1, letterSpacing: '-0.03em' }}>
              {plan === 'yearly' ? '48' : '5'}
            </span>
          </div>
          <div style={{ fontFamily: mono, fontSize: 10, color: dim, marginTop: 4, letterSpacing: '0.06em' }}>
            {plan === 'yearly' ? 'per year · $4/mo' : 'per month'}
          </div>
        </div>

        {/* Features */}
        <div style={{ background: surface, borderRadius: 10, border: `1px solid ${border}`, padding: '4px 0', marginBottom: 22 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 18px', borderBottom: i < FEATURES.length - 1 ? `1px solid ${border}` : 'none' }}>
              <span style={{ fontSize: 10, color: f.premium ? accent : green, flexShrink: 0 }}>{f.premium ? '✦' : '✓'}</span>
              <span style={{ fontFamily: mono, fontSize: 10, color: f.premium ? text : muted, letterSpacing: '0.03em' }}>{f.label}</span>
              {!f.premium && <span style={{ fontFamily: mono, fontSize: 8, color: dim, letterSpacing: '0.1em', textTransform: 'uppercase', marginLeft: 'auto', flexShrink: 0 }}>free</span>}
            </div>
          ))}
        </div>

        {/* CTA */}
        <button onClick={handleUpgrade} disabled={loading} style={{
          width: '100%', background: accent, border: 'none', borderRadius: 8,
          color: bg, fontFamily: mono, fontSize: 11, letterSpacing: '0.12em',
          textTransform: 'uppercase', padding: '14px 0',
          cursor: loading ? 'not-allowed' : 'pointer',
          opacity: loading ? 0.6 : 1, transition: 'opacity 0.15s', marginBottom: 10,
        }}>
          {loading ? 'Loading…' : `Get Premium — ${plan === 'yearly' ? '$48/yr' : '$5/mo'}`}
        </button>

        <div style={{ textAlign: 'center' }}>
          <p style={{ fontFamily: mono, fontSize: 9, color: dim, margin: '0 0 3px', letterSpacing: '0.05em' }}>
            Have a discount code? Enter it on the next screen.
          </p>
          <p style={{ fontFamily: mono, fontSize: 9, color: dim, margin: 0, letterSpacing: '0.05em' }}>
            Cancel anytime · Powered by Stripe
          </p>
        </div>

        {error && <p style={{ fontFamily: mono, fontSize: 10, color: red, textAlign: 'center', marginTop: 14 }}>{error}</p>}
      </div>
    </div>
  );
}

// ── Embedded checkout ─────────────────────────────────────────────────────────
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
    return () => { mounted = false; checkoutRef.current?.destroy(); };
  }, [clientSecret]);

  return (
    <div style={{ flex: 1, padding: '32px 24px 48px', maxWidth: 520, margin: '0 auto', width: '100%' }}>
      <div style={{ textAlign: 'center', marginBottom: 24 }}>
        <h1 style={{ fontFamily: serif, fontSize: 26, color: text, margin: 0, letterSpacing: '-0.02em', fontWeight: 400 }}>Complete your order</h1>
      </div>
      <div ref={containerRef} style={{ borderRadius: 10, overflow: 'hidden' }} />
      <div style={{ textAlign: 'center', marginTop: 18 }}>
        <button onClick={onCancel} style={{ fontFamily: mono, fontSize: 9, letterSpacing: '0.1em', textTransform: 'uppercase', color: dim, background: 'none', border: 'none', cursor: 'pointer' }}>← Back</button>
      </div>
    </div>
  );
}

// ── Root ──────────────────────────────────────────────────────────────────────
function UpgradeContent() {
  const params = useSearchParams();
  const success = params.get('success') === 'true';
  const [session, setSession] = useState(null);
  const [premiumData, setPremiumData] = useState(undefined);
  const [checkoutSecret, setCheckoutSecret] = useState(null);
  const [showPortal, setShowPortal] = useState(false);

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

  if (premiumData === undefined && !success) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 28, height: 28, borderRadius: '50%', border: `1.5px solid ${border2}`, borderTopColor: accent, animation: 'spin 1s linear infinite' }}/>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  let content;
  if (success)                       content = <SuccessView session={session} />;
  else if (showPortal)               content = <PortalView session={session} premiumData={premiumData} onBack={() => setShowPortal(false)} />;
  else if (premiumData?.active)      content = <ManageView session={session} premiumData={premiumData} onManage={() => setShowPortal(true)} />;
  else if (checkoutSecret)           content = <CheckoutView clientSecret={checkoutSecret} onCancel={() => setCheckoutSecret(null)} />;
  else                               content = <PricingView session={session} onStartCheckout={setCheckoutSecret} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <TopBar />
      {content}
    </div>
  );
}

export default function UpgradePage() {
  return (
    <div style={{ background: bg, minHeight: '100vh', color: text }}>
      <Suspense fallback={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
          <span style={{ fontFamily: mono, fontSize: 9, color: dim, letterSpacing: '0.15em' }}>LOADING…</span>
        </div>
      }>
        <UpgradeContent />
      </Suspense>
    </div>
  );
}
