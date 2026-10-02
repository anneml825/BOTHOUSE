import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { parsePaint, sinceLastClear } from './paint';

// Server-only Supabase client. All reads and writes go through the API routes,
// so the browser never needs a Supabase key.
export function getDb(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Next.js caches fetch() results by default; database reads must always be fresh
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}

// Postgres "table does not exist" (42P01) or PostgREST "table not in schema cache" (PGRST205).
export function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

// Pausing holds the turn lock until this date, so no tick can claim it.
export const PAUSED_UNTIL = '9999-01-01T00:00:00.000Z';

export type LockState = 'paused' | 'generating' | 'idle';

// What the turn lock says right now: paused, a bot is mid-reply, or free
export async function getLockState(db: SupabaseClient): Promise<LockState> {
  const { data } = await db.from('turn_lock').select('locked_until').eq('id', 1).maybeSingle();
  if (!data) return 'idle';
  const until = Date.parse(data.locked_until);
  if (until >= Date.parse(PAUSED_UNTIL)) return 'paused';
  return until > Date.now() ? 'generating' : 'idle';
}

// The whole painting: every paint command since the last "clear", from every bot message
export async function loadPaint(db: SupabaseClient): Promise<string[]> {
  const { data } = await db
    .from('messages')
    .select('content')
    .eq('channel', 'bots')
    .or('content.like.*```paint*,content.like.*```draw*')
    .order('id', { ascending: true })
    .limit(5000);
  return sinceLastClear((data ?? []).flatMap((m: { content: string }) => parsePaint(m.content).commands));
}

// Saves the current painting to the gallery. Returns an error message, or null on success.
export async function savePicture(db: SupabaseClient, title: string): Promise<string | null> {
  const paint = await loadPaint(db);
  if (!paint.length) return 'The canvas is empty';
  const { error } = await db.from('drawings').insert({ title: title.slice(0, 100), shapes: { paint } });
  if (!error) return null;
  return isMissingTable(error) ? 'The gallery table doesn’t exist yet. Run the drawings SQL in Supabase.' : error.message;
}
