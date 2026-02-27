import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';
import { DEMO_MESSAGES } from '@/lib/bots';

// =============================================
// GET /api/messages?sessionId=...&limit=50
// Returns recent bot messages for a session.
// Falls back to demo messages if Supabase is not configured.
// =============================================

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200);

  if (!isServerSupabaseConfigured()) {
    const demoMessages = DEMO_MESSAGES.map((m, i) => ({
      id: `demo-${i}`,
      session_id: null,
      bot_id: m.botId,
      message: m.message,
      conversation_type: m.conversationType,
      participants: m.participants,
      is_highlight: false,
      drama_score: Math.floor(Math.random() * 8) + 1,
      created_at: new Date(Date.now() - (DEMO_MESSAGES.length - i) * 45000).toISOString(),
    }));
    return NextResponse.json({ data: demoMessages });
  }

  const supabase = createServerSupabase();

  const { data, error } = sessionId
    ? await supabase
        .from('bot_messages')
        .select('*, bot:bots(*)')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit)
    : await supabase
        .from('bot_messages')
        .select('*, bot:bots(*)')
        .order('created_at', { ascending: false })
        .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return in ascending order (oldest first) for the feed
  return NextResponse.json({ data: (data || []).reverse() });
}
