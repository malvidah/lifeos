// ─── Shared Google helpers ────────────────────────────────────────────────────
// Used across calendar-*, chat, voice-action, agent routes.
// Keep this the single source of truth — do not copy-paste into route files.

import { createClient } from '@supabase/supabase-js';

/**
 * Build a Supabase browser client authenticated as the requesting user.
 * Returns { supabase, token } or { supabase: null, token: null } if no token.
 */
export function getUserClient(req) {
  const token = (req.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!token) return { supabase: null, token: null };
  return {
    token,
    supabase: createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    ),
  };
}

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
  await supabase.from('entries').upsert(
    {
      date: '0000-00-00', type: 'google_token',
      data: { token: accessToken, refreshToken },
      user_id: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'date,type,user_id' }
  );
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
