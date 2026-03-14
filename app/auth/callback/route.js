import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (cookiesToSet) => {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options));
          },
        },
      }
    );
    await supabase.auth.exchangeCodeForSession(code);
  }

  // Use location.replace() instead of a server redirect so the Google OAuth
  // URL is replaced in browser history — prevents "400 malformed request"
  // when the user presses the back button after login.
  const dest = searchParams.get('next') || '/';
  const target = dest.startsWith('/') ? origin + dest : origin;
  return new Response(
    `<!DOCTYPE html><html><head><script>window.location.replace(${JSON.stringify(target)})</script></head><body></body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
