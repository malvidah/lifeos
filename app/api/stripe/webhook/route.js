// Stripe webhook — fires after successful payment.
// Marks user as premium in Supabase using service role key (bypasses RLS).

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export const config = { api: { bodyParser: false } };

export async function POST(request) {
  const sig = request.headers.get('stripe-signature');
  const body = await request.text();

  let event;
  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    return Response.json({ error: `Webhook error: ${e.message}` }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.userId;
    if (!userId) return Response.json({ error: 'no userId' }, { status: 400 });

    // Use service role to bypass RLS — this is a trusted server-to-server call
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );

    await supabase.from('entries').upsert({
      date: 'global',
      type: 'premium',
      data: {
        active: true,
        grantedAt: new Date().toISOString(),
        stripeSessionId: session.id,
        stripeCustomerId: session.customer,
        amountPaid: session.amount_total,
      },
      user_id: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,type,user_id' });
  }

  return Response.json({ received: true });
}
