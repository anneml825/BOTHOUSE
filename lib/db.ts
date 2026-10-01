import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Server-only Supabase client. All reads and writes go through the API routes,
// so the browser never needs a Supabase key.
export function getDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// Postgres "table does not exist" (42P01) or PostgREST "table not in schema cache" (PGRST205).
export function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

// Pausing holds the turn lock until this date, so no tick can claim it.
export const PAUSED_UNTIL = '9999-01-01T00:00:00.000Z';

export async function isPaused(db: SupabaseClient): Promise<boolean> {
  const { data } = await db.from('turn_lock').select('locked_until').eq('id', 1).maybeSingle();
  return !!data && Date.parse(data.locked_until) >= Date.parse(PAUSED_UNTIL);
}
