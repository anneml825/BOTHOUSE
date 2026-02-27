import { createClient } from '@supabase/supabase-js';

// =============================================
// SUPABASE CLIENT (for use in browser / client components)
// =============================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// This is the public client — safe to use in the browser
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

// =============================================
// HELPER: Check if Supabase is configured
// =============================================
export function isSupabaseConfigured(): boolean {
  return (
    !!supabaseUrl &&
    supabaseUrl !== 'https://placeholder.supabase.co' &&
    !!supabaseAnonKey &&
    supabaseAnonKey !== 'placeholder-anon-key'
  );
}
