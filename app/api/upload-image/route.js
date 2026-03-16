import { createClient } from '@supabase/supabase-js';

const BUCKET = 'journal-images';

function getAdminClient() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
}

async function authenticateUser(request) {
  const token = (request.headers.get('authorization') || '').replace('Bearer ', '').trim();
  if (!token) return null;
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { user, supabase };
}

export async function POST(request) {
  try {
    const auth = await authenticateUser(request);
    if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { user, supabase } = auth;

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof Blob)) return Response.json({ error: 'no image' }, { status: 400 });

    const admin = getAdminClient();

    if (admin) {
      const { error: bucketErr } = await admin.storage.createBucket(BUCKET, {
        public: true,
        fileSizeLimit: 10485760,
        allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
      });
      if (bucketErr && !bucketErr.message?.includes('already exists') && !bucketErr.message?.includes('duplicate')) {
        console.warn('Bucket create warning:', bucketErr.message);
      }
    }

    const binary = Buffer.from(await file.arrayBuffer());
    const mimeType = file.type || 'image/jpeg';
    const ext = mimeType.includes('png') ? 'png' : mimeType.includes('gif') ? 'gif' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const path = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const uploadClient = admin || supabase;
    const { error: uploadErr } = await uploadClient.storage
      .from(BUCKET)
      .upload(path, binary, { contentType: mimeType, upsert: false });

    if (uploadErr) {
      console.error('Storage upload failed:', uploadErr.message);
      return Response.json({ error: 'Upload failed' }, { status: 500 });
    }

    const { data: { publicUrl } } = uploadClient.storage.from(BUCKET).getPublicUrl(path);
    return Response.json({ url: publicUrl });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const auth = await authenticateUser(request);
    if (!auth) return Response.json({ error: 'unauthorized' }, { status: 401 });
    const { user } = auth;

    const { url } = await request.json();
    if (!url) return Response.json({ error: 'no url' }, { status: 400 });

    // Extract storage path from public URL (everything after /journal-images/)
    const marker = `/${BUCKET}/`;
    const idx = url.indexOf(marker);
    if (idx === -1) return Response.json({ error: 'invalid url' }, { status: 400 });
    const path = url.slice(idx + marker.length);

    // Only allow deleting files in the user's own folder
    if (!path.startsWith(user.id + '/')) {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }

    const admin = getAdminClient();
    if (!admin) return Response.json({ error: 'storage not configured' }, { status: 500 });

    const { error: removeErr } = await admin.storage.from(BUCKET).remove([path]);
    if (removeErr) {
      console.error('Storage delete failed:', removeErr.message);
      return Response.json({ error: 'Delete failed' }, { status: 500 });
    }

    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
