export async function GET() {
  return Response.json({
    supabase_url:  !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabase_key:  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    oura_token:    !!process.env.OURA_TOKEN,
    anthropic_key: !!process.env.ANTHROPIC_API_KEY,
  });
}
