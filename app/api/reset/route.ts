import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { currentRound, saveRoundPaintings } from '@/lib/rounds';

// POST /api/reset — clears the bot conversation and all rounds, votes and scores, so the contest
// starts fresh. The current round's paintings are saved to the gallery first. Viewer chat is kept.
export async function POST() {
  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { round } = await currentRound(db);
  if (round && round.status !== 'done') await saveRoundPaintings(db, round);

  // Rounds first (votes go with them), so a turn in progress sees its round is gone and drops its reply
  await db.from('rounds').delete().gt('id', 0);
  const { error } = await db.from('messages').delete().eq('channel', 'bots');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
