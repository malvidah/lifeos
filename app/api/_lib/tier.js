// Tier helper — checks premium status from DB, not env var.
// Premium is granted by Stripe webhook writing to the entries table.

export const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY;

// Pass an authenticated supabase client + userId.
// Returns true if user has an active premium row in entries.
export async function isPremium(supabase, userId) {
  try {
    const { data } = await supabase.from('entries').select('data')
      .eq('type', 'premium').eq('date', 'global').eq('user_id', userId).maybeSingle();
    return data?.data?.active === true;
  } catch {
    return false;
  }
}
