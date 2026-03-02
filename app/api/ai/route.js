import { createClient } from '@supabase/supabase-js';

export async function POST(request) {
  const authHeader = request.headers.get("authorization") || "";
  const jwt = authHeader.replace("Bearer ", "").trim();

  let anthropicKey = null;
  let debugInfo = { hasJwt: !!jwt, userId: null, settingsFound: false, keyFound: false };

  if (jwt) {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { global: { headers: { Authorization: `Bearer ${jwt}` } } }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser().catch(() => ({ data: {}, error: "catch" }));
    debugInfo.userId = user?.id || null;
    debugInfo.authErr = authErr || null;

    if (user?.id) {
      const { data: settingsRow, error: settingsErr } = await supabase
        .from("entries")
        .select("data")
        .eq("type", "settings")
        .eq("date", "global")
        .eq("user_id", user.id)
        .maybeSingle();

      debugInfo.settingsFound = !!settingsRow;
      debugInfo.settingsErr = settingsErr?.message || null;
      debugInfo.settingsKeys = settingsRow?.data ? Object.keys(settingsRow.data) : null;
      debugInfo.keyLength = settingsRow?.data?.anthropicKey?.length || 0;

      anthropicKey = settingsRow?.data?.anthropicKey || null;
      debugInfo.keyFound = !!anthropicKey;
    }
  }

  console.log("[ai route]", JSON.stringify(debugInfo));

  if (!anthropicKey) {
    return Response.json({ error: "No Anthropic API key configured", debug: debugInfo }, { status: 402 });
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
  if (!r.ok) console.log("[ai route] anthropic error:", JSON.stringify(data));
  return Response.json(data, { status: r.status });
}
