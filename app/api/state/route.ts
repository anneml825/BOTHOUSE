import { NextResponse } from 'next/server';
import { getDb, isMissingTable, getLockState, loadPaint } from '@/lib/db';
import { currentRound, promptSuggestions, roundTurns, scores, TURNS_PER_BOT, voteCounts } from '@/lib/rounds';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;

// GET /api/state — conversation, chat, both canvases, and the current round (prompt, phase, votes, scores)
export async function GET() {
  const db = getDb();
  if (!db) return NextResponse.json({ setup: 'supabase' });

  const [bots, chat, lock, roundInfo] = await Promise.all([
    db.from('messages').select('id, author, content, created_at').eq('channel', 'bots').order('id', { ascending: false }).limit(100),
    db.from('messages').select('id, author, content, created_at').eq('channel', 'chat').order('id', { ascending: false }).limit(100),
    getLockState(db),
    currentRound(db),
  ]);

  const error = bots.error ?? chat.error;
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ setup: 'tables' });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (roundInfo.missing) return NextResponse.json({ setup: 'rounds' });

  const round = roundInfo.round;
  const afterId = round?.start_message_id ?? 0;
  const [paintA, paintB, votes, score, turnsDone, suggestions] = await Promise.all([
    round ? loadPaint(db, { author: 'A', afterId }) : Promise.resolve([]),
    round ? loadPaint(db, { author: 'B', afterId }) : Promise.resolve([]),
    round ? voteCounts(db, round.id) : Promise.resolve({ A: 0, B: 0 }),
    scores(db),
    round ? roundTurns(db, round) : Promise.resolve(0),
    // Suggestions for the next round: everything typed since the current round started
    promptSuggestions(db, round?.created_at ?? new Date(Date.now() - 10 * 60_000).toISOString()),
  ]);

  return NextResponse.json({
    setup: process.env.ANTHROPIC_API_KEY ? null : 'anthropic',
    paused: lock === 'paused',
    generating: lock === 'generating',
    gapSeconds: 60,
    serverTime: new Date().toISOString(),
    round: round && {
      id: round.id,
      prompt: round.prompt,
      fromChat: round.prompt_from_chat,
      status: round.status,
      votingEndsAt: round.voting_ends_at,
      winner: round.winner,
      turnsDone,
      turnsTotal: TURNS_PER_BOT * 2,
    },
    votes,
    scores: score,
    suggestions: suggestions.slice(0, 5),
    paintA,
    paintB,
    bots: (bots.data ?? []).reverse(),
    chat: (chat.data ?? []).reverse(),
  });
}
