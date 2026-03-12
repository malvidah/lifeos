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

    const { plan } = await request.json();
    const priceId = plan === 'yearly'
      ? process.env.STRIPE_PRICE_ID_YEARLY
      : process.env.STRIPE_PRICE_ID_MONTHLY;

    if (!priceId) return Response.json({ error: 'Price not configured' }, { status: 503 });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = request.headers.get('origin') || `https://${request.headers.get('host') || 'daylab.me'}`;

    // Embedded mode — stays on daylab.me, no redirect to stripe.com
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'embedded',
      mode: 'subscription',
      allow_promotion_codes: true,
      client_reference_id: user.id,
      customer_email: user.email,
      line_items: [{ price: priceId, quantity: 1 }],
      return_url: `${origin}/upgrade?success=true&session_id={CHECKOUT_SESSION_ID}`,
      metadata: { userId: user.id, plan },
    });

    return Response.json({ clientSecret: session.client_secret });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
