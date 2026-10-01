import { NextResponse } from 'next/server';
import { getDb, isMissingTable } from '@/lib/db';

export const dynamic = 'force-dynamic';

// GET /api/state — latest bot conversation and viewer chat
export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ setup: 'supabase' });

  const [bots, chat] = await Promise.all([
    db.from('messages').select('id, author, content, created_at').eq('channel', 'bots').order('id', { ascending: false }).limit(100),
    db.from('messages').select('id, author, content, created_at').eq('channel', 'chat').order('id', { ascending: false }).limit(100),
  ]);

  const error = bots.error ?? chat.error;
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ setup: 'tables' });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    setup: process.env.ANTHROPIC_API_KEY ? null : 'anthropic',
    bots: (bots.data ?? []).reverse(),
    chat: (chat.data ?? []).reverse(),
  });
}
