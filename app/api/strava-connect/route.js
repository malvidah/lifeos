// Initiates Strava OAuth using server-side credentials — user never sees API keys
import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const clientId = process.env.STRAVA_CLIENT_ID;
  if (!clientId) return Response.json({ error: 'Strava not configured' }, { status: 503 });

  const origin = new URL(request.url).origin;
  const redirectUri = `${origin}/strava-callback`;

  const url = new URL('https://www.strava.com/oauth/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'read,activity:read_all');
  url.searchParams.set('approval_prompt', 'auto');

  return Response.redirect(url.toString());
}
