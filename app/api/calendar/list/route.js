// GET /api/calendar/list
// Returns the user's Google Calendar list so the UI can show a calendar picker.
// Each calendar: { id, summary, backgroundColor, primary }

import { withAuth } from '../../_lib/auth.js';
import { refreshGoogleToken, saveGoogleToken } from '../../_lib/google.js';

async function withGoogleToken(supabase, userId, fn) {
  const { data: stored } = await supabase.from("user_settings").select("data")
    .eq("user_id", userId).maybeSingle();

  let accessToken = stored?.data?.googleToken;
  const refreshToken = stored?.data?.googleRefreshToken;

  if (!accessToken && !refreshToken) {
    return { ok: false, status: 401, error: "No Google Calendar connection" };
  }

  let result = accessToken ? await fn(accessToken) : { ok: false, status: 401 };

  if (!result.ok && refreshToken) {
    const newToken = await refreshGoogleToken(refreshToken);
    if (newToken) {
      await saveGoogleToken(supabase, userId, newToken, refreshToken);
      accessToken = newToken;
      result = await fn(newToken);
    }
  }

  return { ...result, accessToken };
}

export const GET = withAuth(async (request, { supabase, user }) => {
  const { ok, status, data, error } = await withGoogleToken(
    supabase, user.id,
    (token) => fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=50", {
      headers: { Authorization: `Bearer ${token}` },
    }).then(async r => ({ ok: r.ok, status: r.status, data: r.ok ? await r.json() : null }))
  );

  if (error) return Response.json({ error }, { status });
  if (!ok) return Response.json({ error: "Calendar list fetch failed" }, { status: status || 500 });

  const calendars = (data?.items || [])
    .filter(cal => cal.accessRole === 'owner' || cal.accessRole === 'writer' || cal.accessRole === 'reader')
    .map(cal => ({
      id:              cal.id,
      summary:         cal.summary || cal.id,
      backgroundColor: cal.backgroundColor || '#4A7A9B',
      primary:         !!cal.primary,
    }))
    .sort((a, b) => {
      if (a.primary) return -1;
      if (b.primary) return 1;
      return a.summary.localeCompare(b.summary);
    });

  return Response.json({ calendars });
});
