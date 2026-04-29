import { NextResponse } from 'next/server';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';

// =============================================
// GET /api/session
// Returns the current live session status.
// In demo mode, reflects NEXT_PUBLIC_DEMO_MODE env var.
// =============================================

export async function GET() {
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({
      data: {
        isLive: false,
        currentSession: null,
        nextSessionTime: null,
      },
    });
  }

  const supabase = createServerSupabase();

  // Check for an active (live) session
  const { data: liveSession } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('status', 'live')
    .maybeSingle();

  if (liveSession) {
    return NextResponse.json({
      data: { isLive: true, currentSession: liveSession, nextSessionTime: null },
    });
  }

  // No live session — find the next scheduled one
  const { data: nextSession } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('status', 'scheduled')
    .gte('scheduled_start', new Date().toISOString())
    .order('scheduled_start', { ascending: true })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    data: {
      isLive: false,
      currentSession: null,
      nextSessionTime: nextSession?.scheduled_start || null,
    },
  });
}
