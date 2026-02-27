import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@supabase/auth-helpers-nextjs';
import { cookies } from 'next/headers';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';

// =============================================
// POST /api/chat   — Send a viewer chat message
// GET  /api/chat   — Fetch recent viewer messages
// =============================================

export async function POST(req: NextRequest) {
  try {
    const { message, sessionId } = await req.json();

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Message is required' }, { status: 400 });
    }

    if (!isServerSupabaseConfigured()) {
      // Demo mode — just acknowledge the message
      return NextResponse.json({ success: true, demo: true });
    }

    // Use the cookie-based Supabase client so RLS sees the authenticated user
    const supabase = createRouteHandlerClient({ cookies });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'You must be signed in to chat' }, { status: 401 });
    }

    const { error } = await supabase.from('viewer_messages').insert({
      user_id: user.id,
      username: user.user_metadata?.username || user.email?.split('@')[0] || 'viewer',
      message: message.trim().slice(0, 200),
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
