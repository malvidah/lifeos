// Simple in-memory rate limiter.
// ⚠️  IMPORTANT: On Vercel, each serverless function is isolated — a user hitting
// different routes simultaneously bypasses the per-route limit, and cold starts
// reset all counts. This is acceptable for low-traffic personal use.
// For production multi-user enforcement, swap the Map for Redis/Upstash Edge Store.

const counts = new Map(); // key -> { count, resetAt }

export function rateLimit(key, { max, windowMs }) {
  const now = Date.now();
  const entry = counts.get(key);

  if (!entry || now > entry.resetAt) {
    counts.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }

  if (entry.count >= max) {
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }

  entry.count++;
  return { ok: true };
}
