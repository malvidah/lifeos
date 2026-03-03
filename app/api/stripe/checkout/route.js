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

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = request.headers.get('origin') || 'https://dayloop.me';

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      allow_promotion_codes: true,
      client_reference_id: user.id,
      customer_email: user.email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${origin}/upgrade?success=true`,
      cancel_url: `${origin}/upgrade`,
      metadata: { userId: user.id },
    });

    return Response.json({ url: session.url });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
