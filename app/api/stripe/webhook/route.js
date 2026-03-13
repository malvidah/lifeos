import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

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

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Grant premium on successful checkout
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.client_reference_id || session.metadata?.userId;
    if (!userId) return Response.json({ error: 'no userId' }, { status: 400 });

    const { data: existing } = await supabase.from('user_settings')
      .select('data').eq('user_id', userId).maybeSingle();

    await supabase.from('user_settings').upsert({
      user_id: userId,
      data: {
        ...(existing?.data || {}),
        premium: {
          active: true,
          plan: session.metadata?.plan || 'monthly',
          grantedAt: new Date().toISOString(),
          stripeSessionId: session.id,
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
        },
      },
    }, { onConflict: 'user_id' });
  }

  // Revoke premium if subscription is cancelled or payment fails
  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    const obj = event.data.object;
    const customerId = obj.customer;
    // Look up user by stripe customer ID stored in user_settings
    const { data: rows } = await supabase.from('user_settings').select('user_id, data');
    const match = rows?.find(r => r.data?.premium?.stripeCustomerId === customerId);
    if (match) {
      await supabase.from('user_settings').upsert({
        user_id: match.user_id,
        data: {
          ...match.data,
          premium: { ...match.data.premium, active: false, revokedAt: new Date().toISOString() },
        },
      }, { onConflict: 'user_id' });
    }
  }

  return Response.json({ received: true });
}
