import { createClient } from '@supabase/supabase-js';

const BUCKET = 'journal-images';

export async function POST(request) {
  try {
    const token = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
    if (!token) return Response.json({ error: 'unauthorized' }, { status: 401 });

    // User-scoped client (RLS) for auth check
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${token}` } } }
    );
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return Response.json({ error: 'unauthorized' }, { status: 401 });

    const { image, mimeType } = await request.json();
    if (!image) return Response.json({ error: 'no image' }, { status: 400 });

    // Service-role client for storage (bypasses RLS for bucket ops)
    const admin = process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
      : null;

    if (admin) {
      // Ensure bucket exists (idempotent)
      const { error: bucketErr } = await admin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 10485760,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      });
      // Ignore "already exists" error
      if (bucketErr && !bucketErr.message?.includes('already exists') && !bucketErr.message?.includes('duplicate')) {
        console.warn('Bucket create warning:', bucketErr.message);
      }
    }

    const binary = Buffer.from(image, 'base64');
    const ext = mimeType?.includes('png') ? 'png' : mimeType?.includes('gif') ? 'gif' : mimeType?.includes('webp') ? 'webp' : 'jpg';
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    // Upload using user token (needs storage policy) or admin if available
    const uploadClient = admin || supabase;
    const { error: uploadErr } = await uploadClient.storage
      .from(BUCKET)
      .upload(path, binary, { contentType: mimeType || 'image/jpeg', upsert: false });

    if (uploadErr) {
      // Fallback: return base64 data URI (stored inline in text)
      console.warn('Storage upload failed, using data URI:', uploadErr.message);
      return Response.json({ url: `data:${mimeType || 'image/jpeg'};base64,${image}` });
    }

    const { data: { publicUrl } } = uploadClient.storage.from(BUCKET).getPublicUrl(path);
    return Response.json({ url: publicUrl });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
