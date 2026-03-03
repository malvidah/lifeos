// RFC7591 — OAuth 2.0 Dynamic Client Registration
// Claude POSTs here automatically on first connect — no manual setup needed
import { createClient } from '@supabase/supabase-js';

const SERVICE_UUID = '00000000-0000-0000-0000-000000000000';

const svc = () => createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function randomHex(bytes) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch {}

  const { client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method } = body;

  if (!redirect_uris?.length) {
    return Response.json({ error: 'invalid_client_metadata', error_description: 'redirect_uris required' }, { status: 400 });
  }

  const client_id = 'dlc_' + randomHex(16);
  // Public clients (Claude is a public client) don't get a client_secret
  const isPkceClient = token_endpoint_auth_method === 'none' || !token_endpoint_auth_method;

  const clientData = {
    client_id,
    client_name: client_name || 'Unknown Client',
    redirect_uris,
    grant_types: grant_types || ['authorization_code'],
    response_types: response_types || ['code'],
    token_endpoint_auth_method: isPkceClient ? 'none' : 'client_secret_basic',
    created_at: new Date().toISOString(),
  };

  await svc().from('entries').upsert(
    {
      date: `oauth_client:${client_id}`,
      type: 'oauth_client',
      user_id: SERVICE_UUID,
      data: clientData,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'date,type,user_id' }
  );

  return Response.json({
    client_id,
    client_name: clientData.client_name,
    redirect_uris,
    grant_types: clientData.grant_types,
    response_types: clientData.response_types,
    token_endpoint_auth_method: clientData.token_endpoint_auth_method,
    registration_access_token: randomHex(24), // not enforced but expected
  }, { status: 201 });
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
