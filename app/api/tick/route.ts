import { NextResponse } from 'next/server';
import { getDb, isMissingTable, loadPaint, PAUSED_UNTIL } from '@/lib/db';
import { nextTurn, Anthropic } from '@/lib/claude';
import { BotKey, splitGloss } from '@/lib/bots';
import { renderPaintPng } from '@/lib/render';
import { wordFor } from '@/lib/words';

export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const revalidate = 0;
// Thinking takes a while; Vercel's Fluid compute allows up to 300s on the Hobby plan
export const maxDuration = 300;

// Minimum time between bot messages
const GAP_MS = 60_000;
// The window of history sent to the model moves in steps of this size, so the
// prefix stays identical (and cached) for many turns in a row.
const WINDOW_STEP = 20;
// Turns spent planning and blocking in before the bots switch to refining only
const COMPOSE_TURNS = 4;

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
    // Older messages may carry a translation line from an earlier version; strip it
    const messages: Anthropic.Beta.BetaMessageParam[] = history.map((m) => ({
      role: m.author === speaker ? 'assistant' : 'user',
      content: splitGloss(m.content).body,
    }));
    while (messages.length && messages[0].role === 'assistant') messages.shift();

    // Show the speaker the canvas as it is now. Attached only to this request's last message,
    // so the stored history (and the cached prefix) doesn't change.
    const paint = await loadPaint(db);
    const png = paint.length ? renderPaintPng(paint) : null;

    // Which phase the painting is in: compose first, then only refine (no new objects).
    // Like the image, this is attached to this request only, so stored history and cache don't change.
    const turn = total; // bot messages so far, including the opening "Hi."
    const phase =
      turn <= COMPOSE_TURNS
        ? `[Painting turn ${turn}: composition phase. Plan the whole picture and block in the main shapes, values and colors.]`
        : `[Painting turn ${turn}: refinement phase. Do not add new objects or figures. Spend this turn improving what is ` +
          `already on the canvas: shading, form, texture, detail, edges and corrected proportions.]`;

    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'user' && typeof lastMsg.content === 'string') {
      lastMsg.content = [
        { type: 'text', text: lastMsg.content },
        { type: 'text', text: phase },
        ...(png
          ? [
              { type: 'text' as const, text: 'The canvas right now:' },
              { type: 'image' as const, source: { type: 'base64' as const, media_type: 'image/png' as const, data: png } },
            ]
          : []),
      ];
    }

    // The conversation's first message id picks its random word, so every START OVER gets a new one
    const { data: first } = await db
      .from('messages')
      .select('id')
      .eq('channel', 'bots')
      .order('id', { ascending: true })
      .limit(1)
      .maybeSingle();
    const inspiration = wordFor(first?.id ?? 0);

    const startedAt = Date.now();
    const reply = await nextTurn(speaker, messages, inspiration);
    if (!reply) return NextResponse.json({ status: 'no_reply' });

    // If the owner pressed Start over while this reply was being written, drop it
    const { count: countNow } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('channel', 'bots');
    if ((countNow ?? 0) < total) return NextResponse.json({ status: 'reset_during_turn' });

    const { error: insertError } = await db.from('messages').insert({ channel: 'bots', author: speaker, content: reply });
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
