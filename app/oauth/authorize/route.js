// OAuth 2.1 Authorization Endpoint
// GET → returns HTML consent page
// POST → processes Allow/Deny and redirects with code
import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

const SERVICE_UUID = '00000000-0000-0000-0000-000000000000';

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getSession() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet) => toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options)),
      },
    }
  );
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function getClient(client_id) {
  const { data } = await svc().from('entries')
    .select('data')
    .eq('date', `oauth_client:${client_id}`)
    .eq('type', 'oauth_client')
    .eq('user_id', SERVICE_UUID)
    .maybeSingle();
  return data?.data || null;
}

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

function errorRedirect(redirect_uri, error, state) {
  const url = new URL(redirect_uri);
  url.searchParams.set('error', error);
  if (state) url.searchParams.set('state', state);
  return Response.redirect(url.toString());
}

// ── GET — render consent page ─────────────────────────────────────────────────
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const params = {
    client_id: searchParams.get('client_id'),
    redirect_uri: searchParams.get('redirect_uri'),
    state: searchParams.get('state') || '',
    code_challenge: searchParams.get('code_challenge'),
    code_challenge_method: searchParams.get('code_challenge_method') || 'S256',
    response_type: searchParams.get('response_type'),
    resource: searchParams.get('resource') || '',
    scope: searchParams.get('scope') || 'dayloop',
  };

  if (!params.client_id || !params.redirect_uri || params.response_type !== 'code') {
    return new Response('Missing required parameters', { status: 400 });
  }

  const client = await getClient(params.client_id);
  if (!client) return new Response('Unknown client', { status: 400 });

  if (!client.redirect_uris.includes(params.redirect_uri)) {
    return new Response('Invalid redirect_uri', { status: 400 });
  }

  const user = await getSession();
  const encodedParams = encodeURIComponent(JSON.stringify(params));
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const returnUrl = `/oauth/authorize?${searchParams.toString()}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Connect Day Loop to ${client.client_name}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0E0E0F;color:#E8E0D4;font-family:'Georgia',serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .card{background:#18181A;border:1px solid #2A2A2E;border-radius:12px;padding:36px;max-width:420px;width:100%;box-shadow:0 24px 48px rgba(0,0,0,0.4)}
    .logo{font-family:'Georgia',serif;font-size:22px;color:#C4A882;letter-spacing:-0.02em;text-align:center;margin-bottom:4px}
    .arrow{display:flex;align-items:center;justify-content:center;gap:10px;margin:16px 0 24px;color:#666}
    .arrow svg{flex-shrink:0}
    .client-name{background:#1E1E21;border:1px solid #2A2A2E;border-radius:6px;padding:8px 14px;font-family:monospace;font-size:13px;color:#9B9B9B;text-align:center}
    h1{font-size:17px;color:#E8E0D4;text-align:center;margin-bottom:8px;font-weight:normal}
    .sub{font-family:monospace;font-size:12px;color:#666;text-align:center;margin-bottom:24px;letter-spacing:0.02em}
    .perms{background:#111113;border:1px solid #222225;border-radius:8px;padding:16px;margin-bottom:24px}
    .perm{display:flex;align-items:flex-start;gap:10px;padding:6px 0}
    .perm:not(:last-child){border-bottom:1px solid #1E1E21}
    .perm-icon{color:#C4A882;font-size:14px;margin-top:1px;flex-shrink:0}
    .perm-text{font-family:monospace;font-size:12px;color:#9B9B9B;line-height:1.4}
    .perm-text strong{color:#C8C0B4;display:block;margin-bottom:2px}
    .actions{display:flex;gap:10px}
    .btn-allow{flex:2;background:#C4A882;border:none;border-radius:8px;padding:12px;color:#0E0E0F;font-family:monospace;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;font-weight:600;transition:opacity 0.15s}
    .btn-allow:hover{opacity:0.9}
    .btn-deny{flex:1;background:none;border:1px solid #2A2A2E;border-radius:8px;padding:12px;color:#666;font-family:monospace;font-size:13px;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;transition:border-color 0.15s}
    .btn-deny:hover{border-color:#666;color:#9B9B9B}
    .divider{height:1px;background:#1E1E21;margin:20px 0}
    .login-label{font-family:monospace;font-size:11px;color:#666;text-align:center;margin-bottom:12px;letter-spacing:0.08em;text-transform:uppercase}
    .btn-google{width:100%;background:#18181A;border:1px solid #2A2A2E;border-radius:8px;padding:12px;color:#C8C0B4;font-family:monospace;font-size:13px;letter-spacing:0.06em;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:10px;transition:border-color 0.15s;text-decoration:none}
    .btn-google:hover{border-color:#C4A882}
    .user-badge{background:#111113;border:1px solid #1E1E21;border-radius:6px;padding:7px 12px;font-family:monospace;font-size:11px;color:#666;text-align:center;margin-bottom:16px}
    .user-badge span{color:#9B9B9B}
    .switch-link{font-family:monospace;font-size:11px;color:#555;text-align:center;margin-top:10px}
    .switch-link a{color:#7A9BB0;text-decoration:none}
    input[type=hidden]{}
  </style>
</head>
<body>
<div class="card">
  <div class="logo">Day Loop</div>
  <div class="arrow">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3"/><polyline points="13 8 18 12 13 16"/><line x1="18" y1="12" x2="6" y2="12"/></svg>
    <div class="client-name">${client.client_name}</div>
  </div>

  ${user ? `
  <h1>Allow access to your Day Loop?</h1>
  <p class="sub">Signed in as <span style="color:#C4A882">${user.email}</span></p>

  <div class="perms">
    <div class="perm">
      <div class="perm-icon">✓</div>
      <div class="perm-text"><strong>Read your data</strong>View tasks, meals, notes, and activity</div>
    </div>
    <div class="perm">
      <div class="perm-icon">✓</div>
      <div class="perm-text"><strong>Add &amp; edit entries</strong>Create tasks, log meals, append notes</div>
    </div>
    <div class="perm">
      <div class="perm-icon">✓</div>
      <div class="perm-text"><strong>Calendar access</strong>Add events to your Google Calendar</div>
    </div>
    <div class="perm">
      <div class="perm-icon" style="color:#666">✗</div>
      <div class="perm-text"><strong style="color:#666">Cannot delete your account</strong>Or access payment or health data</div>
    </div>
  </div>

  <form method="POST">
    <input type="hidden" name="params" value="${encodedParams}"/>
    <div class="actions">
      <button type="submit" name="action" value="allow" class="btn-allow">Allow access</button>
      <button type="submit" name="action" value="deny" class="btn-deny">Deny</button>
    </div>
  </form>
  <div class="switch-link">Not you? <a href="/oauth/authorize?${searchParams.toString()}&logout=1">Sign in with a different account</a></div>
  ` : `
  <h1>Sign in to connect Day Loop</h1>
  <p class="sub" style="margin-bottom:20px">${client.client_name} is requesting access to your Day Loop</p>
  <div class="login-label">Sign in to continue</div>
  <div id="auth-area">
    <a href="#" id="google-btn" class="btn-google">
      <svg width="16" height="16" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
      Continue with Google
    </a>
  </div>
  <script>
    const SUPABASE_URL = "${SUPABASE_URL}";
    const SUPABASE_ANON = "${SUPABASE_ANON}";
    const returnUrl = "${returnUrl.replace(/"/g, '&quot;')}";

    document.getElementById('google-btn').addEventListener('click', async (e) => {
      e.preventDefault();
      const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
      const sb = createClient(SUPABASE_URL, SUPABASE_ANON);
      const { error } = await sb.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin + '/auth/callback?next=' + encodeURIComponent(returnUrl) }
      });
      if (error) alert('Sign in failed: ' + error.message);
    });
  </script>
  `}
</div>
</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// ── POST — process Allow / Deny ────────────────────────────────────────────────
export async function POST(request) {
  const user = await getSession();
  if (!user) return new Response('Not authenticated', { status: 401 });

  const formData = await request.formData();
  const action = formData.get('action');
  const paramsRaw = formData.get('params');

  let params;
  try { params = JSON.parse(decodeURIComponent(paramsRaw)); }
  catch { return new Response('Invalid params', { status: 400 }); }

  const { client_id, redirect_uri, state, code_challenge, code_challenge_method, resource } = params;

  if (action !== 'allow') {
    return errorRedirect(redirect_uri, 'access_denied', state);
  }

  // Validate client still exists
  const client = await getClient(client_id);
  if (!client || !client.redirect_uris.includes(redirect_uri)) {
    return errorRedirect(redirect_uri, 'invalid_client', state);
  }

  // Generate authorization code (10 min TTL)
  const code = randomHex(32);
  const expires_at = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  await svc().from('entries').upsert(
    {
      date: `oauth_code:${code}`,
      type: 'oauth_code',
      user_id: user.id,
      data: { client_id, redirect_uri, code_challenge, code_challenge_method: code_challenge_method || 'S256', expires_at, resource, used: false },
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'date,type,user_id' }
  );

  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);

  return Response.redirect(redirectUrl.toString());
}
