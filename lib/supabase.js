// Browser client — singleton to avoid multiple GoTrueClient instances
import { createBrowserClient } from '@supabase/ssr';

let _client = null;

export function createClient() {
  if (_client) return _client;
  _client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  return _client;
}
