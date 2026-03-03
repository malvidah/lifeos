// Fallback grant — called from success page if webhook didn't fire fast enough.
// Verifies the session is paid before granting premium.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const userSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user }, error: authErr } = await userSupabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { sessionId } = await request.json();
    if (!sessionId) return Response.json({ error: 'sessionId required' }, { status: 400 });

    // Verify with Stripe that payment actually completed
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== 'paid' && session.status !== 'complete') {
      return Response.json({ error: 'Payment not completed' }, { status: 402 });
    }

    // Verify the session belongs to this user
    if (session.client_reference_id !== user.id && session.metadata?.userId !== user.id) {
      return Response.json({ error: 'Session mismatch' }, { status: 403 });
    }

    // Grant premium using service role (bypasses RLS)
    const adminSupabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await adminSupabase.from('entries').upsert({
      date: 'global', type: 'premium',
      data: {
        active: true,
        plan: session.metadata?.plan || 'monthly',
        grantedAt: new Date().toISOString(),
        stripeSessionId: session.id,
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      },
      user_id: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,type,user_id' });

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
