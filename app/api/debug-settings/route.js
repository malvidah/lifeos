import { createClient } from '@supabase/supabase-js';

export async function GET(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();
  if (!jwt) return Response.json({ error: "no auth header" }, { status: 401 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } }
  );

  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) return Response.json({ error: "auth failed", detail: authErr?.message }, { status: 401 });

  const { data: settingsRow, error: readErr } = await supabase
    .from("entries")
    .select("data, updated_at")
    .eq("type", "settings")
    .eq("date", "global")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: allRows, error: allErr } = await supabase
    .from("entries")
    .select("date, type, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(20);

  return Response.json({
    userId: user.id,
    email: user.email,
    settingsRow: settingsRow ? {
      hasOuraToken: !!settingsRow.data?.ouraToken,
      ouraTokenLength: settingsRow.data?.ouraToken?.length || 0,
      hasAnthropicKey: !!settingsRow.data?.anthropicKey,
      anthropicKeyLength: settingsRow.data?.anthropicKey?.length || 0,
      updatedAt: settingsRow.updated_at,
    } : null,
    readError: readErr?.message || null,
    recentRows: allRows?.map(r => ({ date: r.date, type: r.type, updated: r.updated_at })) || [],
    allRowsError: allErr?.message || null,
  });
}
