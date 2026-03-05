import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const body = await request.json();
  const { date, ...healthData } = body;
  if (!date) return Response.json({ error: "date required" }, { status: 400 });

  const { error } = await supabase
    .from("entries")
    .upsert({
      user_id: user.id,
      date,
      type: "health_apple",
      data: healthData,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,date,type" });

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
