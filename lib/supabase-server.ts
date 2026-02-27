import { createClient } from '@supabase/supabase-js';

// =============================================
// SUPABASE SERVER CLIENT (for API routes / server components)
// Uses the service role key — NEVER expose this in the browser
// =============================================

export function createServerSupabase() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

// =============================================
// HELPER: Check if server Supabase is configured
// =============================================
export function isServerSupabaseConfigured(): boolean {
  return (
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_URL !== 'https://placeholder.supabase.co' &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY !== 'placeholder-service-role-key'
  );
}
