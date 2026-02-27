import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';

// =============================================
// POST /api/chat   — Send a viewer chat message (no auth required)
// GET  /api/chat   — Fetch recent viewer messages
// =============================================

export async function POST(req: NextRequest) {
  try {
    const { message, username, sessionId } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    const safeUsername = (username || 'viewer').toString().trim().slice(0, 30) || 'viewer';
    const safeMessage = message.trim().slice(0, 200);

    if (!isServerSupabaseConfigured()) {
      // Demo mode — optimistic UI handles display client-side
      return NextResponse.json({ success: true, demo: true });
    }

    // Use service role to insert — user_id is nullable (migration 003)
    // and the "viewer_messages_public_insert" RLS policy allows this
    const supabase = createServerSupabase();

    const { error } = await supabase.from('viewer_messages').insert({
      user_id: null,
      username: safeUsername,
      message: safeMessage,
      session_id: sessionId || null,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[/api/chat POST]', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get('sessionId');

  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ data: [] });
  }

  const supabase = createServerSupabase();

  const { data, error } = sessionId
    ? await supabase
        .from('viewer_messages')
        .select('*')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(100)
    : await supabase
        .from('viewer_messages')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data: (data || []).reverse() });
}
