// Shared tier helper — used by all AI routes.
// Premium user IDs live in PREMIUM_USER_IDS env var (comma-separated Supabase UUIDs).
// To grant premium: add UUID to Vercel env var and redeploy.

export function isPremium(userId) {
  const list = process.env.PREMIUM_USER_IDS || '';
  return list.split(',').map(s => s.trim()).filter(Boolean).includes(userId);
}

export const ANTHROPIC_KEY = () => process.env.ANTHROPIC_API_KEY;
