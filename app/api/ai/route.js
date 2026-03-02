import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();

  let anthropicKey = null;

  if (jwt) {
    // Try to get user's own Anthropic API key from their settings
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );
    const { data: { user } } = await supabase.auth.getUser().catch(() => ({ data: {} }));
    if (user?.id) {
      const { data: settingsRow } = await supabase
        .from("entries")
        .select("data")
        .eq("type", "settings")
        .eq("date", "global")
        .eq("user_id", user.id)
        .maybeSingle()
        .catch(() => ({ data: null }));
      anthropicKey = settingsRow?.data?.anthropicKey || null;
    }
  }

  if (!anthropicKey) {
    return Response.json({ error: "No Anthropic API key configured" }, { status: 402 });
  }

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
}
