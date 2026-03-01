import { saveEntry, loadEntry, loadDay } from '@/lib/db';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get('date');
  const type = searchParams.get('type');
  if (!date) return Response.json({ error: 'date required' }, { status: 400 });
  try {
    if (type) {
      const data = await loadEntry(date, type);
      return Response.json({ data });
    } else {
      const day = await loadDay(date);
      return Response.json({ day });
    }
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const { date, type, data } = await req.json();
    if (!date || !type || data === undefined) {
      return Response.json({ error: 'date, type, data required' }, { status: 400 });
    }
    await saveEntry(date, type, data);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
