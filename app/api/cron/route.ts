import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';
import { getNextConversation, buildUserPrompt, calculateDramaScore } from '@/lib/director';
import { generateBotMessage, isAnthropicConfigured } from '@/lib/anthropic';
import { CHARACTER_BIBLES, BOTS, BOT_IDS } from '@/lib/bots';
import { BotId } from '@/types';

// =============================================
// GET /api/cron
//
// Called by Vercel Cron every minute.
// This is what makes the show run on its own:
//
//  1. Find or auto-create the live session
//  2. Ask the Director who talks next and what type of conversation
//  3. Generate each bot's message via Claude Haiku (sequentially
//     so each bot can react to the one before it)
//  4. Save each message to Supabase as it's generated
//     → Supabase Realtime broadcasts it to every viewer instantly
//
// Protected with CRON_SECRET so only Vercel can trigger it.
// =============================================

export const maxDuration = 60; // allow up to 60s on Pro plan; 10s on Hobby

export async function GET(req: NextRequest) {
  // ---- Auth -------------------------------------------------------
  // Vercel sets Authorization: Bearer <CRON_SECRET> on every cron call
  const authHeader = req.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---- Preflight checks -------------------------------------------
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'Supabase not configured' });
  }
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'Anthropic not configured' });
  }

  const supabase = createServerSupabase();

  // ---- Session management -----------------------------------------
  // Find an active live session or create one automatically so the
  // show runs without any manual admin intervention.
  const session = await getOrCreateSession(supabase);
  if (!session) {
    return NextResponse.json({ error: 'Could not get or create session' }, { status: 500 });
  }

  // ---- Load recent context ----------------------------------------
  // Last 12 messages give the bots enough memory to stay coherent.
  const { data: recentRows } = await supabase
    .from('bot_messages')
    .select('bot_id, message, created_at')
    .eq('session_id', session.id)
    .order('created_at', { ascending: false })
    .limit(12);

  const recentMessages = (recentRows || []).reverse(); // oldest first
  const recentSpeakers = recentMessages.slice(-5).map((m) => m.bot_id as BotId);
  const context: Array<{ botId: BotId; message: string }> = recentMessages.map((m) => ({
    botId: m.bot_id as BotId,
    message: m.message,
  }));

  // ---- Director decides who talks next ----------------------------
  const decision = getNextConversation(recentSpeakers, BOT_IDS);
  const botNames = Object.fromEntries(
    Object.entries(BOTS).map(([id, b]) => [id, b.name])
  ) as Record<BotId, string>;

  // ---- Generate messages sequentially -----------------------------
  // We do this one-at-a-time so each bot genuinely reacts to the
  // previous bot's message rather than replying to empty air.
  const thisConvoContext = [...context]; // grows as each bot speaks
  const generated: Array<{ botId: BotId; dramaScore: number }> = [];

  for (const botId of decision.speakers) {
    try {
      // Get system prompt from DB (has full character bible), or fall
      // back to building one from static data if DB isn't seeded yet.
      const { data: botRow } = await supabase
        .from('bots')
        .select('system_prompt')
        .eq('id', botId)
        .single();

      const systemPrompt = botRow?.system_prompt || buildFallbackSystemPrompt(botId);

      // Last 6 messages as conversation context for the API call
      const contextMessages = thisConvoContext.slice(-6).map((m) => ({
        role: (m.botId === botId ? 'assistant' : 'user') as 'user' | 'assistant',
        content: `${botNames[m.botId] || m.botId}: ${m.message}`,
      }));

      const userPrompt = buildUserPrompt(
        {
          botId,
          conversationType: decision.conversationType,
          participants: decision.speakers,
          recentMessages: thisConvoContext,
          eventPrompt: decision.eventPrompt,
          sessionId: session.id,
        },
        botNames
      );

      // Call Claude Haiku — fast + cheap, ~1-2s per message
      const message = await generateBotMessage(systemPrompt, contextMessages, userPrompt);
      const dramaScore = calculateDramaScore(message);

      // Save to DB immediately — this fires the Supabase Realtime
      // event that pushes the message to every viewer's browser NOW
      await supabase.from('bot_messages').insert({
        session_id: session.id,
        bot_id: botId,
        message,
        conversation_type: decision.conversationType,
        participants: decision.speakers,
        drama_score: dramaScore,
        is_highlight: dramaScore >= 8,
      });

      // Append to local context so the next bot in this conversation
      // has something to respond to
      thisConvoContext.push({ botId, message });
      generated.push({ botId, dramaScore });
    } catch (err) {
      // Log but don't abort — let the remaining bots in the convo still run
      console.error(`[cron] Failed for bot ${botId}:`, err);
    }
  }

  // ---- Update session drama peak if needed ------------------------
  const avgDrama =
    generated.length > 0
      ? generated.reduce((sum, g) => sum + g.dramaScore, 0) / generated.length
      : 0;

  if (avgDrama >= 7) {
    // High drama moment — could surface this in the UI later
    await supabase
      .from('live_sessions')
      .update({ viewer_peak: session.viewer_peak + 1 })
      .eq('id', session.id);
  }

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    conversationType: decision.conversationType,
    speakers: decision.speakers,
    messagesGenerated: generated.length,
    avgDramaScore: Math.round(avgDrama * 10) / 10,
  });
}

// =============================================
// Build a system prompt from static data when
// the bots table hasn't been seeded yet
// =============================================
function buildFallbackSystemPrompt(botId: BotId): string {
  const bot = BOTS[botId];
  const bible = CHARACTER_BIBLES[botId];
  return [
    `You are ${bot.name} in Bot House — an AI reality show.`,
    `PERSONALITY: ${bot.personalityTraits.join(', ')}`,
    `TAGLINE: "${bot.tagline}"`,
    bible ? `BACKSTORY: ${bible.backstory}` : '',
    bible ? `YOU WANT: ${bible.wants}` : '',
    bible ? `YOUR FEARS: ${bible.fears}` : '',
    `CATCHPHRASES: ${bot.catchphrases.join(' | ')}`,
    '',
    'Stay in character at all times. Keep responses to 1-3 sentences.',
  ]
    .filter(Boolean)
    .join('\n');
}

// =============================================
// Find a live session or create everything needed
// (season → session) so the show runs automatically
// =============================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateSession(supabase: any) {
  // 1. Return existing live session if one is running
  const { data: liveSession } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('status', 'live')
    .maybeSingle();

  if (liveSession) return liveSession;

  // 2. Find or create an active season
  let seasonId: number;

  const { data: activeSeason } = await supabase
    .from('seasons')
    .select('id')
    .eq('status', 'active')
    .maybeSingle();

  if (activeSeason) {
    seasonId = activeSeason.id;
  } else {
    const { data: newSeason, error: seasonErr } = await supabase
      .from('seasons')
      .insert({
        season_number: 1,
        title: 'Season 1: Unhinged',
        description: 'The bots move in. Chaos follows.',
        status: 'active',
        start_date: new Date().toISOString().split('T')[0],
      })
      .select('id')
      .single();

    if (seasonErr || !newSeason) {
      console.error('[cron] Could not create season:', seasonErr);
      return null;
    }
    seasonId = newSeason.id;
  }

  // 3. Count existing sessions so we can number the new one
  const { count } = await supabase
    .from('live_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId);

  const sessionNumber = (count || 0) + 1;
  const now = new Date();
  const end = new Date(now.getTime() + 8 * 60 * 60 * 1000); // runs for 8 hours

  const { data: newSession, error: sessionErr } = await supabase
    .from('live_sessions')
    .insert({
      season_id: seasonId,
      session_number: sessionNumber,
      scheduled_start: now.toISOString(),
      scheduled_end: end.toISOString(),
      actual_start: now.toISOString(),
      status: 'live',
    })
    .select('*')
    .single();

  if (sessionErr) {
    console.error('[cron] Could not create session:', sessionErr);
    return null;
  }

  return newSession;
}
