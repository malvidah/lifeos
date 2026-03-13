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

    // Look up the Stripe customer ID from user_settings.data.premium
    const { data: settings } = await supabase.from('user_settings').select('data')
      .eq('user_id', user.id).maybeSingle();

    const customerId = settings?.data?.premium?.stripeCustomerId;
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
