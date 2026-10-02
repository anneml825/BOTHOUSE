import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { currentRound } from '@/lib/rounds';

// POST /api/vote — { roundId, choice: 'A' | 'B', voter } — one vote per viewer per round.
// Voting again in the same round changes your vote.
export async function POST(req: NextRequest) {
  const { roundId, choice, voter } = await req.json().catch(() => ({}));
  if (choice !== 'A' && choice !== 'B') return NextResponse.json({ error: 'Invalid choice' }, { status: 400 });
  const voterId = String(voter ?? '').slice(0, 64);
  if (voterId.length < 8) return NextResponse.json({ error: 'Invalid voter' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });

  const { round } = await currentRound(db);
  if (!round || Number(round.id) !== Number(roundId) || round.status !== 'voting') {
    return NextResponse.json({ error: 'Voting is closed for this round' }, { status: 400 });
  }
  const { error } = await db
    .from('votes')
    .upsert({ round_id: round.id, voter: voterId, choice }, { onConflict: 'round_id,voter' });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
