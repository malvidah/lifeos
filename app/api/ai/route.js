import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  try {
    const authHeader = request.headers.get("authorization") || "";
    const jwt = authHeader.replace("Bearer ", "").trim();
    if (!jwt) return Response.json({ error: "unauthorized" }, { status: 401 });

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser()
      .catch(() => ({ data: {}, error: "catch" }));
    if (authErr || !user?.id) return Response.json({ error: "unauthorized" }, { status: 401 });

    const { data: settingsRow } = await supabase
      .from("entries").select("data")
      .eq("type", "settings").eq("date", "global").eq("user_id", user.id)
      .maybeSingle().catch(() => ({ data: null }));

    const anthropicKey = settingsRow?.data?.anthropicKey;
    if (!anthropicKey) return Response.json({ error: "no_anthropic_key" }, { status: 402 });

    const body = await request.json();
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    return Response.json(data, { status: r.status });
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
