import { NextResponse } from 'next/server';
import { getDb, isMissingTable } from '@/lib/db';
import { currentRound, saveRoundPaintings } from '@/lib/rounds';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// GET /api/gallery — saved drawings, newest first
export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  const { data, error } = await db
    .from('drawings')
    .select('id, title, shapes, created_at')
    .order('id', { ascending: false })
    .limit(60);
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ setup: 'drawings', drawings: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ drawings: data ?? [] });
}

// POST /api/gallery — saves both bots' paintings from the current round
export async function POST() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { round, missing } = await currentRound(db);
  if (missing) return NextResponse.json({ error: 'The rounds table doesn’t exist yet. Run the rounds SQL in Supabase.' }, { status: 400 });
  if (!round) return NextResponse.json({ error: 'Nothing has been painted yet' }, { status: 400 });

  const problem = await saveRoundPaintings(db, round);
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });
  return NextResponse.json({ ok: true });
}
