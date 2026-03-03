// Simple in-memory rate limiter. Resets on cold start, good enough for
// serverless where each instance handles one request at a time.
// For high traffic, swap this map for a Redis/Upstash store.

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
