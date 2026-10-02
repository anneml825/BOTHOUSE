import { NextRequest, NextResponse } from 'next/server';
import { getDb, PAUSED_UNTIL } from '@/lib/db';

// POST /api/pause — { paused } — pause or resume the bots
export async function POST(req: NextRequest) {
  const { paused } = await req.json().catch(() => ({}));

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { error } = await db
    .from('turn_lock')
    .update({ locked_until: paused ? PAUSED_UNTIL : new Date().toISOString() })
    .eq('id', 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ paused: !!paused });
}
