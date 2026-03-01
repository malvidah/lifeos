const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function sb(path, method = "GET", body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": method === "POST" ? "resolution=merge-duplicates,return=representation" : "return=representation",
    },
    body: body ? JSON.stringify(body) : null,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase ${method} ${path} → ${res.status}: ${err}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// GET /api/journal?date=2026-03-01
// GET /api/journal?date=2026-03-01&type=notes
export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  const type = searchParams.get("type");

  if (!date) return Response.json({ error: "date required" }, { status: 400 });

  let path = `/journal?date=eq.${date}&order=type`;
  if (type) path += `&type=eq.${type}`;

  try {
    const rows = await sb(path);
    // Return as { notes: {...}, meals: [...}, ... }
    const result = {};
    for (const row of rows) result[row.type] = row.data;
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// POST /api/journal  { date, type, data }
export async function POST(request) {
  try {
    const { date, type, data } = await request.json();
    if (!date || !type || data === undefined) {
      return Response.json({ error: "date, type, data required" }, { status: 400 });
    }

    // Upsert — insert or update if (date, type) already exists
    const rows = await sb("/journal", "POST", { date, type, data });
    return Response.json({ ok: true, row: rows?.[0] });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
