// GET   /api/profile/me  → current user's profile fields
// PATCH /api/profile/me  → update handle/display_name/bio/avatar_url/banner_url/profile_public
//
// Profile fields live in user_settings.data as a flat JSONB blob alongside
// other settings. A unique partial index on lower(data->>'handle') prevents
// two users from claiming the same handle.

import { withAuth } from '../../_lib/auth.js';

const HANDLE_RE = /^[a-z0-9_-]{2,32}$/;

const PROFILE_FIELDS = [
  'handle', 'display_name', 'bio', 'avatar_url', 'banner_url', 'profile_public',
];

function pickProfile(data = {}) {
  const out = {};
  for (const k of PROFILE_FIELDS) {
    if (data[k] !== undefined) out[k] = data[k];
  }
  return out;
}

export const GET = withAuth(async (_req, { supabase, user }) => {
  const { data } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
  return Response.json({ profile: pickProfile(data?.data || {}) });
});

export const PATCH = withAuth(async (req, { supabase, user }) => {
  const body = await req.json().catch(() => ({}));

  // Build whitelist of profile updates
  const updates = {};
  for (const k of PROFILE_FIELDS) {
    if (body[k] === undefined) continue;
    let v = body[k];
    if (k === 'handle') {
      v = (v || '').toString().trim().toLowerCase();
      if (v && !HANDLE_RE.test(v)) {
        return Response.json({ error: 'Handle must be 2–32 chars: a–z, 0–9, _ or -' }, { status: 400 });
      }
    } else if (k === 'profile_public') {
      v = !!v;
    } else if (typeof v === 'string') {
      v = v.trim().slice(0, k === 'bio' ? 500 : 200) || null;
    }
    updates[k] = v;
  }

  if (Object.keys(updates).length === 0) {
    return Response.json({ error: 'no fields to update' }, { status: 400 });
  }

  // Pre-check handle uniqueness (gives a friendlier error than the unique-index violation)
  if (updates.handle) {
    const { data: existing } = await supabase
      .from('user_settings').select('user_id, data')
      .filter('data->>handle', 'eq', updates.handle)
      .maybeSingle();
    if (existing && existing.user_id !== user.id) {
      return Response.json({ error: 'handle taken', code: 'handle_taken' }, { status: 409 });
    }
  }

  // Merge into existing data blob (preserves googleToken, projectsMeta, etc.)
  const { data: row } = await supabase
    .from('user_settings').select('data').eq('user_id', user.id).maybeSingle();
  const merged = { ...(row?.data || {}), ...updates };

  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, data: merged }, { onConflict: 'user_id' });
  if (error) {
    if (error.code === '23505') {
      return Response.json({ error: 'handle taken', code: 'handle_taken' }, { status: 409 });
    }
    throw error;
  }

  return Response.json({ profile: pickProfile(merged) });
});
