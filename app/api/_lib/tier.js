// Tier helper — checks premium status from user_settings.
// Premium is granted by Stripe webhook writing to user_settings.data.premium.

export const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY;

// Pass an authenticated supabase client + userId.
// Returns true if user has an active premium entry in user_settings.
export async function isPremium(supabase, userId) {
  try {
    const { data } = await supabase.from('user_settings').select('data')
      .eq('user_id', userId).maybeSingle();
    return data?.data?.premium?.active === true;
  } catch {
    return false;
  }
}
