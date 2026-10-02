import { NextResponse } from 'next/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { getDb, isMissingTable, loadPaint, PAUSED_UNTIL } from '@/lib/db';
import { nextTurn, Anthropic } from '@/lib/claude';
import { BOTS, BotKey, splitGloss } from '@/lib/bots';
import { renderPaintPng } from '@/lib/render';
import { currentRound, finishRound, Round, roundTurns, startRound, TURNS_PER_BOT, VOTE_MS, voteCounts } from '@/lib/rounds';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
// Thinking takes a while; Vercel's Fluid compute allows up to 300s on the Hobby plan
export const maxDuration = 300;

// Minimum time between bot messages (BOT_GAP_MS overrides it, for testing)
const GAP_MS = Number(process.env.BOT_GAP_MS) || 60_000;
// The window of history sent to the model moves in steps of this size, so the
// prefix stays identical (and cached) for many turns in a row.
const WINDOW_STEP = 20;

// POST /api/tick — called every few seconds by any open page. Runs the head-to-head rounds:
// start a round with chat's prompt → bots take turns painting their own canvases → viewers vote →
// winner saved → next round. Whoever claims the lock does the next step; everyone else gets "busy".
// Nothing runs when nobody has the page open, or while paused (the lock is held far in the future).
export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ status: 'missing_anthropic_key' });
  const db = getDb();
  if (!db) return NextResponse.json({ status: 'missing_supabase' });

  // Cheap check first, so the lock is only taken when something is actually due
  const due = await whatIsDue(db);
  if (due.status !== 'due') return NextResponse.json(due);

  const now = Date.now();
  const claim = await db
    .from('turn_lock')
    .update({ locked_until: new Date(now + 310_000).toISOString() })
    .eq('id', 1)
    .lt('locked_until', new Date(now).toISOString())
    .select('id');
  if (claim.error) {
    if (isMissingTable(claim.error)) return NextResponse.json({ status: 'missing_tables' });
    return NextResponse.json({ status: 'error', message: claim.error.message }, { status: 500 });
  }
  if (!claim.data?.length) return NextResponse.json({ status: 'busy' });

  try {
    const { round } = await currentRound(db);

    // No round yet, or the last one is over: start the next one with chat's prompt
    if (!round || round.status === 'done') {
      const next = await startRound(db, round);
      return NextResponse.json({ status: 'round_started', message: `prompt: ${next.prompt}` });
    }

    // Voting: close it once the time is up
    if (round.status === 'voting') {
      if (round.voting_ends_at && Date.now() >= Date.parse(round.voting_ends_at)) {
        const winner = await finishRound(db, round);
        return NextResponse.json({ status: 'round_finished', message: `winner: ${winner}` });
      }
      return NextResponse.json({ status: 'voting' });
    }

    // Painting: once both bots have had all their turns, open voting
    const turnsDone = await roundTurns(db, round);
    if (turnsDone >= TURNS_PER_BOT * 2) {
      await db
        .from('rounds')
        .update({ status: 'voting', voting_ends_at: new Date(Date.now() + VOTE_MS).toISOString() })
        .eq('id', round.id);
      return NextResponse.json({ status: 'voting_started' });
    }

    return await paintTurn(db, round, turnsDone);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ status: 'bad_anthropic_key' });
    }
    console.error('[tick]', err);
    const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    return NextResponse.json({ status: 'error', message }, { status: 500 });
  } finally {
    // Release the lock, unless the bots were paused while this turn was running
    await db.from('turn_lock').update({ locked_until: new Date().toISOString() }).eq('id', 1).lt('locked_until', PAUSED_UNTIL);
  }
}

// Decides without locking whether a tick has anything to do right now
async function whatIsDue(db: SupabaseClient): Promise<{ status: string; message?: string }> {
  const { round, missing } = await currentRound(db);
  if (missing) return { status: 'missing_tables' };
  if (!round || round.status === 'done') return { status: 'due' };
  if (round.status === 'voting') {
    return round.voting_ends_at && Date.now() >= Date.parse(round.voting_ends_at) ? { status: 'due' } : { status: 'voting' };
  }
  // All turns painted: open voting right away
  if ((await roundTurns(db, round)) >= TURNS_PER_BOT * 2) return { status: 'due' };
  const { data: latest } = await db
    .from('messages')
    .select('id, created_at')
    .eq('channel', 'bots')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  // The first turn of a round starts right away; later turns wait for the gap
  if (latest && latest.id > round.start_message_id) {
    const ago = Date.now() - Date.parse(latest.created_at);
    if (ago < GAP_MS) return { status: 'waiting', message: `last bot message was ${Math.round(ago / 1000)}s ago` };
  }
  return { status: 'due' };
}

// One bot paints one turn on its own canvas
async function paintTurn(db: SupabaseClient, round: Round, turnsDone: number) {
  // Sonnet (A) opens every round; they alternate from there
  const speaker: BotKey = turnsDone % 2 === 0 ? 'A' : 'B';
  const opponent: BotKey = speaker === 'A' ? 'B' : 'A';
  const myTurn = Math.floor(turnsDone / 2) + 1;

  const { count } = await db.from('messages').select('id', { count: 'exact', head: true }).eq('channel', 'bots');
  const total = count ?? 0;
  const start = Math.max(0, Math.floor((total - WINDOW_STEP) / WINDOW_STEP) * WINDOW_STEP);
  const { data: history, error } = total
    ? await db
        .from('messages')
        .select('author, content')
        .eq('channel', 'bots')
        .order('id', { ascending: true })
        .range(start, total - 1)
    : { data: [], error: null };
  if (error) throw error;

  // From the speaker's point of view its own lines are "assistant", the other bot's are "user".
  // Older messages may carry a translation line from an earlier version; strip it.
  const messages: Anthropic.Beta.BetaMessageParam[] = (history ?? []).map((m) => ({
    role: m.author === speaker ? 'assistant' : 'user',
    content: splitGloss(m.content).body,
  }));
  while (messages.length && messages[0].role === 'assistant') messages.shift();
  // The request must end on a "user" message for the speaker to reply to
  if (!messages.length || messages[messages.length - 1].role === 'assistant') {
    messages.push({ role: 'user', content: '(Your move.)' });
  }

  // The round brief and both canvases, attached to this request only so stored history and cache don't change
  const brief = await roundBrief(db, round, speaker, myTurn);
  const mine = await loadPaint(db, { author: speaker, afterId: round.start_message_id });
  const theirs = await loadPaint(db, { author: opponent, afterId: round.start_message_id });
  const image = (paint: string[]) => {
    if (!paint.length) return [];
    const png = renderPaintPng(paint);
    return png ? [{ type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: png } }] : [];
  };
  const lastMsg = messages[messages.length - 1];
  const original = typeof lastMsg.content === 'string' ? [{ type: 'text' as const, text: lastMsg.content }] : lastMsg.content;
  lastMsg.content = [
    ...original,
    { type: 'text', text: brief },
    { type: 'text', text: `Your canvas right now${mine.length ? '' : ' (blank)'}:` },
    ...image(mine),
    { type: 'text', text: `${BOTS[opponent].name}'s canvas right now${theirs.length ? '' : ' (blank)'}:` },
    ...image(theirs),
  ];

  const startedAt = Date.now();
  const reply = await nextTurn(speaker, messages);
  if (!reply) return NextResponse.json({ status: 'no_reply' });

  // If someone pressed Start over while this reply was being written, drop it
  const { round: stillCurrent } = await currentRound(db);
  if (!stillCurrent || Number(stillCurrent.id) !== Number(round.id)) return NextResponse.json({ status: 'reset_during_turn' });

  const { error: insertError } = await db.from('messages').insert({ channel: 'bots', author: speaker, content: reply });
  if (insertError) throw insertError;
  return NextResponse.json({
    status: 'spoke',
    message: `${BOTS[speaker].name} took ${Math.round((Date.now() - startedAt) / 1000)}s`,
  });
}

// What the speaker is told about the contest this turn
async function roundBrief(db: SupabaseClient, round: Round, speaker: BotKey, myTurn: number): Promise<string> {
  const lines = [
    `[Head-to-head round. Prompt: "${round.prompt}"${round.prompt_from_chat ? ' (chosen by the audience)' : ''}.`,
    `This is your turn ${myTurn} of ${TURNS_PER_BOT}. You paint only on your own canvas; your opponent paints on theirs.`,
    myTurn === 1
      ? 'Plan the whole picture now and block in the composition, main shapes, values and colors.'
      : 'Refine what is already on your canvas: shading, form, texture, detail, edges and corrected proportions. Do not start over.',
    `After both of you finish your ${TURNS_PER_BOT} turns, the audience votes on the better painting.`,
  ];
  // Mention how the previous round went, so they can gloat or seethe
  const { data: prev } = await db
    .from('rounds')
    .select('id, prompt, winner')
    .eq('status', 'done')
    .lt('id', round.id)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (prev) {
    const v = await voteCounts(db, prev.id);
    const result =
      prev.winner === 'tie'
        ? `it was a tie, ${v.A}–${v.B}`
        : `${BOTS[prev.winner as BotKey].name} won, ${Math.max(v.A, v.B)}–${Math.min(v.A, v.B)}`;
    lines.push(`Last round ("${prev.prompt}"): ${result}.`);
  }
  return lines.join(' ') + ']';
}
