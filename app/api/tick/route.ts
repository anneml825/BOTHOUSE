import { NextResponse } from 'next/server';
import { getDb, isMissingTable } from '@/lib/db';
import { nextTurn, Anthropic } from '@/lib/claude';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Minimum pause between bot messages, so viewers can read along
const GAP_MS = 6000;
// The window of history sent to the model moves in steps of this size, so the
// prefix stays identical (and cached) for many turns in a row.
const WINDOW_STEP = 20;

// POST /api/tick — called every few seconds by any open page.
// Whoever claims the lock generates the next bot message; everyone else gets "busy".
// Nothing runs when nobody has the page open.
export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ status: 'missing_anthropic_key' });
  const db = getDb();
  if (!db) return NextResponse.json({ status: 'missing_supabase' });

  const now = Date.now();
  const claim = await db
    .from('turn_lock')
    .update({ locked_until: new Date(now + 55_000).toISOString() })
    .eq('id', 1)
    .lt('locked_until', new Date(now).toISOString())
    .select('id');
  if (claim.error) {
    if (isMissingTable(claim.error)) return NextResponse.json({ status: 'missing_tables' });
    return NextResponse.json({ status: 'error', message: claim.error.message }, { status: 500 });
  }
  if (!claim.data?.length) return NextResponse.json({ status: 'busy' });

  try {
    const { count, error: countError } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'bots');
    if (countError) throw countError;
    const total = count ?? 0;

    // Empty conversation: Bot B says hi, Bot A answers on the next tick
    if (total === 0) {
      await db.from('messages').insert({ channel: 'bots', author: 'B', content: 'Hi.' });
      return NextResponse.json({ status: 'started' });
    }

    const start = Math.max(0, Math.floor((total - WINDOW_STEP) / WINDOW_STEP) * WINDOW_STEP);
    const { data: history, error: historyError } = await db
      .from('messages')
      .select('author, content, created_at')
      .eq('channel', 'bots')
      .order('id', { ascending: true })
      .range(start, total - 1);
    if (historyError) throw historyError;

    const last = history[history.length - 1];
    if (now - Date.parse(last.created_at) < GAP_MS) return NextResponse.json({ status: 'waiting' });

    const speaker = last.author === 'A' ? 'B' : 'A';

    // From the speaker's point of view its own lines are "assistant", the other bot's are "user".
    // The API requires the first message to be from the user.
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
      role: m.author === speaker ? 'assistant' : 'user',
      content: m.content,
    }));
    while (messages.length && messages[0].role === 'assistant') messages.shift();

    const reply = await nextTurn(messages);
    if (!reply) return NextResponse.json({ status: 'no_reply' });

    const { error: insertError } = await db.from('messages').insert({ channel: 'bots', author: speaker, content: reply });
    if (insertError) throw insertError;
    return NextResponse.json({ status: 'spoke', speaker });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return NextResponse.json({ status: 'bad_anthropic_key' });
    }
    console.error('[tick]', err);
    const message = err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
    return NextResponse.json({ status: 'error', message }, { status: 500 });
  } finally {
    await db.from('turn_lock').update({ locked_until: new Date().toISOString() }).eq('id', 1);
  }
}
