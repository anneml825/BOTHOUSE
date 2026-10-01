import { NextResponse } from 'next/server';
import { getDb, isMissingTable, PAUSED_UNTIL } from '@/lib/db';
import { nextTurn, translate, Anthropic } from '@/lib/claude';
import { BOTS, BotKey, GLOSS_MARK, splitGloss } from '@/lib/bots';
import { parseDrawing } from '@/lib/canvas';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
export const maxDuration = 60;

// Minimum time between bot messages
const GAP_MS = 30_000;
// The window of history sent to the model moves in steps of this size, so the
// prefix stays identical (and cached) for many turns in a row.
const WINDOW_STEP = 20;

// POST /api/tick — called every few seconds by any open page.
// Whoever claims the lock generates the next bot message; everyone else gets "busy".
// Nothing runs when nobody has the page open, or while paused (the lock is held far in the future).
export async function POST() {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ status: 'missing_anthropic_key' });
  const db = getDb();
  if (!db) return NextResponse.json({ status: 'missing_supabase' });

  const now = Date.now();

  // Cheap check first, so the lock is only taken when a bot is actually due to speak
  const latest = await db
    .from('messages')
    .select('created_at')
    .eq('channel', 'bots')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error && isMissingTable(latest.error)) return NextResponse.json({ status: 'missing_tables' });
  if (latest.data && now - Date.parse(latest.data.created_at) < GAP_MS) {
    const secondsAgo = Math.round((now - Date.parse(latest.data.created_at)) / 1000);
    return NextResponse.json({ status: 'waiting', message: `last bot message was ${secondsAgo}s ago` });
  }

  const claim = await db
    .from('turn_lock')
    .update({ locked_until: new Date(now + 70_000).toISOString() })
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

    const speaker: BotKey = last.author === 'A' ? 'B' : 'A';

    // From the speaker's point of view its own lines are "assistant", the other bot's are "user".
    // The API requires the first message to be from the user.
    // Translations are for viewers only and are stripped before the bots see the history
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
      role: m.author === speaker ? 'assistant' : 'user',
      content: splitGloss(m.content).body,
    }));
    while (messages.length && messages[0].role === 'assistant') messages.shift();

    const startedAt = Date.now();
    const reply = await nextTurn(speaker, messages);
    if (!reply) return NextResponse.json({ status: 'no_reply' });

    // If the owner pressed Start over while this reply was being written, drop it
    const { count: countNow } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'bots');
    if ((countNow ?? 0) < total) return NextResponse.json({ status: 'reset_during_turn' });

    // Translate for the page if there's time left before Vercel's 60s limit
    let content = reply;
    if (Date.now() - startedAt < 35_000) {
      // Translate only what they said, not their drawing commands
      const recent = [...history.slice(-5), { author: speaker, content: reply }].map((m) => ({
        name: BOTS[m.author as BotKey]?.name ?? m.author,
        text: parseDrawing(splitGloss(m.content).body).text,
      }));
      const gloss = recent[recent.length - 1].text ? await translate(recent) : null;
      if (gloss) content = `${reply}\n${GLOSS_MARK} ${gloss}`;
    }

    const { error: insertError } = await db.from('messages').insert({ channel: 'bots', author: speaker, content });
    if (insertError) throw insertError;
    return NextResponse.json({ status: 'spoke', message: `Bot ${speaker} took ${Math.round((Date.now() - startedAt) / 1000)}s` });
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
