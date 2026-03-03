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

    await supabase.from('entries').upsert({
      date: 'global', type: 'premium',
      data: {
        active: true,
        plan: session.metadata?.plan || 'monthly',
        grantedAt: new Date().toISOString(),
        stripeSessionId: session.id,
        stripeCustomerId: session.customer,
        stripeSubscriptionId: session.subscription,
      },
      user_id: userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,type,user_id' });
  }

  // Revoke premium if subscription is cancelled or payment fails
  if (event.type === 'customer.subscription.deleted' || event.type === 'invoice.payment_failed') {
    const obj = event.data.object;
    const customerId = obj.customer;
    // Look up user by stripe customer ID
    const { data: rows } = await supabase.from('entries')
      .select('user_id, data').eq('type', 'premium').eq('date', 'global');
    const match = rows?.find(r => r.data?.stripeCustomerId === customerId);
    if (match) {
      await supabase.from('entries').upsert({
        date: 'global', type: 'premium',
        data: { ...match.data, active: false, revokedAt: new Date().toISOString() },
        user_id: match.user_id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'date,type,user_id' });
    }
  }

  return Response.json({ received: true });
}
