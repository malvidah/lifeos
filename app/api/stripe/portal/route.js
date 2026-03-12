// Creates a Stripe Customer Portal session so users can manage/cancel their plan.
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const jwt = authHeader.replace('Bearer ', '').trim();
    if (!jwt) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    // Look up the Stripe customer ID from their premium row
    const { data: premRow } = await supabase.from('entries').select('data')
      .eq('type', 'premium').eq('date', 'global').eq('user_id', user.id).maybeSingle();

    const customerId = premRow?.data?.stripeCustomerId;
    if (!customerId) return Response.json({ error: 'No billing account found' }, { status: 404 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = request.headers.get('origin') || 'https://daylab.me';

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${origin}/upgrade?from=portal`,
    });

    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
