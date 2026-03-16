import { withAuth } from '../_lib/auth.js';
import { withGoogleToken } from '../_lib/google.js';

// GET /api/photos?date=YYYY-MM-DD
// Returns photos from Google Photos for the given date.
// { photos: [{ id, baseUrl, width, height, timestamp, filename, mimeType }] }

export const GET = withAuth(async (req, { supabase, user }) => {
  const date = new URL(req.url).searchParams.get('date');
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });

  const [year, month, day] = date.split('-').map(Number);

  const { ok, status, data, error } = await withGoogleToken(supabase, user.id, async (token) => {
    const res = await fetch('https://photoslibrary.googleapis.com/v1/mediaItems:search', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pageSize: 100,
        filters: {
          dateFilter: {
            dates: [{ year, month, day }],
          },
          mediaTypeFilter: {
            mediaTypes: ['PHOTO'],
          },
        },
      }),
    });

    if (!res.ok) {
      return { ok: false, status: res.status };
    }

    const body = await res.json();
    return { ok: true, data: body };
  });

  if (!ok) {
    if (status === 401) return Response.json({ photos: [], error: 'no_token' });
    return Response.json({ photos: [] });
  }

  const items = data?.mediaItems || [];
  const photos = items.map(item => ({
    id:        item.id,
    baseUrl:   item.baseUrl,
    width:     item.mediaMetadata?.width ? Number(item.mediaMetadata.width) : null,
    height:    item.mediaMetadata?.height ? Number(item.mediaMetadata.height) : null,
    timestamp: item.mediaMetadata?.creationTime || null,
    filename:  item.filename || null,
    mimeType:  item.mimeType || null,
  }));

  return Response.json({ photos });
});
