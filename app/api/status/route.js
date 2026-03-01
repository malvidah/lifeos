// GET /api/status — confirms env vars are present (never exposes values)
export async function GET() {
  return Response.json({
    supabase_url:      !!process.env.SUPABASE_URL,
    supabase_key:      !!process.env.SUPABASE_ANON_KEY,
    oura_token:        !!process.env.OURA_TOKEN,
    anthropic_key:     !!process.env.ANTHROPIC_API_KEY,
  });
}
