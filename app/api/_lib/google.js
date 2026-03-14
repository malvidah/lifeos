// ─── Shared Google helpers ────────────────────────────────────────────────────
// Used across calendar, chat, voice-action, agent routes.
// Auth is handled by withAuth() from _lib/auth.js — these are Google-specific utilities.

/**
 * Exchange a Google refresh token for a new access token.
 * Returns the new access token string, or null on failure.
 */
export async function refreshGoogleToken(refreshToken) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type:    'refresh_token',
    }),
  });
  const data = await r.json();
  return (!r.ok || !data.access_token) ? null : data.access_token;
}

/**
 * Persist a refreshed access token back to Supabase.
 * Keeps the existing refresh token — Google only sends it once.
 */
export async function saveGoogleToken(supabase, userId, accessToken, refreshToken) {
  const { data: existing } = await supabase.from('user_settings')
    .select('data').eq('user_id', userId).maybeSingle();
  await supabase.from('user_settings').upsert({
    user_id: userId,
    data: { ...(existing?.data || {}), googleToken: accessToken, googleRefreshToken: refreshToken },
  }, { onConflict: 'user_id' });
}

/**
 * Build a Google Calendar event body from common params.
 * @param {string} date       – YYYY-MM-DD
 * @param {object} opts
 *   title, startTime (HH:MM), endTime (HH:MM), allDay (bool), tz (IANA string)
 */
export function buildGCalEventBody(date, { title, startTime, endTime, allDay, tz = 'America/Los_Angeles' }) {
  if (allDay || !startTime) {
    const next = new Date(date + 'T12:00:00');
    next.setDate(next.getDate() + 1);
    return {
      summary: title,
      start: { date },
      end:   { date: next.toISOString().split('T')[0] },
    };
  }
  const endT = endTime || (() => {
    const [h, m] = startTime.split(':').map(Number);
    return `${String((h + 1) % 24).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  })();
  return {
    summary: title,
    start: { dateTime: `${date}T${startTime}:00`, timeZone: tz },
    end:   { dateTime: `${date}T${endT}:00`,       timeZone: tz },
  };
}
