// OAuth 2.1 Token Endpoint
// Handles: authorization_code exchange (with PKCE) + refresh_token
import { createClient } from '@supabase/supabase-js';

const SERVICE_UUID = '00000000-0000-0000-0000-000000000000';
const ACCESS_TOKEN_TTL = 60 * 60;          // 1 hour in seconds
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

// SHA-256 using Web Crypto (available in Next.js edge/Node runtime)
async function sha256base64url(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function mintTokenPair(userId, clientId, { resource, deleteOldRefresh } = {}) {
  const accessToken = 'dla_' + randomHex(32);
  const refreshToken = 'dlr_' + randomHex(32);
  const now = Date.now();
  const accessExpires = new Date(now + ACCESS_TOKEN_TTL * 1000).toISOString();
  const refreshExpires = new Date(now + REFRESH_TOKEN_TTL * 1000).toISOString();
  const db = svc();
  const ops = [
    db.from('entries').upsert({
      date: `oauth_token:${accessToken}`,
      type: 'oauth_token',
      user_id: userId,
      data: { access_token: accessToken, refresh_token: refreshToken, client_id: clientId, access_expires_at: accessExpires, refresh_expires_at: refreshExpires, ...(resource != null && { resource }) },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,type,user_id' }),
    db.from('entries').upsert({
      date: `oauth_refresh:${refreshToken}`,
      type: 'oauth_refresh',
      user_id: userId,
      data: { access_token: accessToken, client_id: clientId, refresh_expires_at: refreshExpires },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'date,type,user_id' }),
  ];
  if (deleteOldRefresh) {
    ops.push(db.from('entries').delete().eq('date', `oauth_refresh:${deleteOldRefresh}`).eq('type', 'oauth_refresh'));
  }
  await Promise.all(ops);
  return { accessToken, refreshToken };
}

function tokenError(error, description, status = 400) {
  return Response.json({ error, error_description: description }, {
    status,
    headers: cors()
  });
}

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'Pragma': 'no-cache',
  };
}

export async function POST(request) {
  let body;
  const ct = request.headers.get('content-type') || '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await request.text();
    const p = new URLSearchParams(text);
    body = Object.fromEntries(p.entries());
  } else {
    try { body = await request.json(); } catch { body = {}; }
  }

  const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token } = body;

  // ── Authorization Code Exchange ────────────────────────────────────────────
  if (grant_type === 'authorization_code') {
    if (!code || !client_id) {
      return tokenError('invalid_request', 'code and client_id required');
    }

    // Load the auth code
    const { data: codeRow } = await svc().from('entries')
      .select('data, user_id')
      .eq('date', `oauth_code:${code}`)
      .eq('type', 'oauth_code')
      .maybeSingle();

    if (!codeRow) return tokenError('invalid_grant', 'Authorization code not found');
    const codeData = codeRow.data;

    // Check expiry
    if (new Date(codeData.expires_at) < new Date()) {
      return tokenError('invalid_grant', 'Authorization code expired');
    }

    // Check already used
    if (codeData.used) return tokenError('invalid_grant', 'Authorization code already used');

    // Verify client_id matches
    if (codeData.client_id !== client_id) {
      return tokenError('invalid_grant', 'client_id mismatch');
    }

    // Verify redirect_uri matches
    if (redirect_uri && codeData.redirect_uri !== redirect_uri) {
      return tokenError('invalid_grant', 'redirect_uri mismatch');
    }

    // PKCE verification (S256)
    if (codeData.code_challenge) {
      if (!code_verifier) return tokenError('invalid_grant', 'code_verifier required');
      const challenge = await sha256base64url(code_verifier);
      if (challenge !== codeData.code_challenge) {
        return tokenError('invalid_grant', 'PKCE verification failed');
      }
    }

    // Mark code as used (prevent replay)
    await svc().from('entries').update({
      data: { ...codeData, used: true },
      updated_at: new Date().toISOString(),
    }).eq('date', `oauth_code:${code}`).eq('type', 'oauth_code');

    const userId = codeRow.user_id;
    const { accessToken, refreshToken } = await mintTokenPair(userId, client_id, { resource: codeData.resource });

    return Response.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: refreshToken,
      scope: 'daylab',
    }, { headers: cors() });
  }

  // ── Refresh Token ──────────────────────────────────────────────────────────
  if (grant_type === 'refresh_token') {
    if (!refresh_token) return tokenError('invalid_request', 'refresh_token required');

    const { data: refreshRow } = await svc().from('entries')
      .select('data, user_id')
      .eq('date', `oauth_refresh:${refresh_token}`)
      .eq('type', 'oauth_refresh')
      .maybeSingle();

    if (!refreshRow) return tokenError('invalid_grant', 'Refresh token not found');

    if (new Date(refreshRow.data.refresh_expires_at) < new Date()) {
      return tokenError('invalid_grant', 'Refresh token expired');
    }

    const userId = refreshRow.user_id;
    const { accessToken: newAccessToken, refreshToken: newRefreshToken } = await mintTokenPair(
      userId, refreshRow.data.client_id, { deleteOldRefresh: refresh_token }
    );

    return Response.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL,
      refresh_token: newRefreshToken,
      scope: 'daylab',
    }, { headers: cors() });
  }

  return tokenError('unsupported_grant_type', `Grant type '${grant_type}' not supported`);
}

export async function OPTIONS() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }
  });
}
