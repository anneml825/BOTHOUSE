import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';
import { getNextConversation, buildUserPrompt, calculateDramaScore } from '@/lib/director';
import { generateBotMessage, isAnthropicConfigured } from '@/lib/anthropic';
import { CHARACTER_BIBLES, BOTS, BOT_IDS } from '@/lib/bots';
import { BotId } from '@/types';
import {
  isShowTime,
  loadBotMemories,
  loadAllRelationships,
  buildMemoryContext,
  closeSessionAndExtractMemories,
} from '@/lib/memory';

// =============================================
// GET /api/cron
//
// Called every minute by Vercel Cron (vercel.json).
// This runs the show — but only 7–11pm ET.
//
// Each minute during show hours:
//   1. Find or auto-create the live session
//   2. Director picks who talks + conversation type
//   3. Load each bot's memories + house relationships
//      from past episodes so they actually remember
//      what happened (who they're dating, who they
//      hate, what went down last night, etc.)
//   4. Generate each bot's message sequentially via
//      Claude Haiku — each bot sees the previous
//      bot's message before responding
//   5. Save to Supabase → Realtime pushes it to all
//      viewer browsers instantly
//
// At 11pm: close the session and run AI memory
// extraction on the full transcript, so tonight's
// drama becomes tomorrow's permanent memories.
//
// Protected by CRON_SECRET so only Vercel can call it.
// =============================================

export const maxDuration = 60; // up to 60s on Pro, 10s on Hobby

export async function GET(req: NextRequest) {
  // ---- Auth -------------------------------------------------------
  const authHeader = req.headers.get('authorization');
  if (
    process.env.CRON_SECRET &&
    authHeader !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ---- Preflight --------------------------------------------------
  if (!isServerSupabaseConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'Supabase not configured' });
  }
  if (!isAnthropicConfigured()) {
    return NextResponse.json({ skipped: true, reason: 'Anthropic not configured' });
  }

  const supabase = createServerSupabase();

  // ---- Outside show hours -----------------------------------------
  // The cron still fires every minute 24/7, but we only run the show
  // 7–11pm. The first cron after 11pm closes the live session and
  // runs memory extraction on the full transcript.
  if (!isShowTime()) {
    const { data: liveSession } = await supabase
      .from('live_sessions')
      .select('*')
      .eq('status', 'live')
      .maybeSingle();

    if (liveSession) {
      // Episode just ended — wrap it up and extract tonight's memories
      await closeSessionAndExtractMemories(supabase, liveSession);
      return NextResponse.json({
        ok: true,
        action: 'episode_ended',
        sessionId: liveSession.id,
      });
    }

    return NextResponse.json({ skipped: true, reason: 'Outside show hours (7–11pm ET)' });
  }

  // ---- Find or create the live session ----------------------------
  const session = await getOrCreateSession(supabase);
  if (!session) {
    return NextResponse.json({ error: 'Could not get or create session' }, { status: 500 });
  }

  // ---- Load shared data once — reused across all rounds -----------
  const allRelationships = await loadAllRelationships(supabase);
  const botNames = Object.fromEntries(
    Object.entries(BOTS).map(([id, b]) => [id, b.name])
  ) as Record<BotId, string>;

  // ---- Detect viewer-driven topics from live chat ----------
  // Two ways viewers can steer the bots:
  //   1. Type "TALK ABOUT X" — the most popular X wins
  //   2. Spam any word 3+ times across messages — gets picked up automatically
  let viewerTopic: string | undefined;
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Fetch recent viewer messages — no session filter so messages saved before
  // the sessionId fix (session_id = null) are also caught
  const { data: recentViewerMsgs } = await supabase
    .from('viewer_messages')
    .select('message')
    .gte('created_at', fiveMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(60);

  if (recentViewerMsgs && recentViewerMsgs.length > 0) {
    // 1. Count explicit "TALK ABOUT X" topics — most popular wins
    const topicCounts: Record<string, number> = {};
    for (const vm of recentViewerMsgs) {
      const match = (vm.message as string).match(/\bTALK\s+ABOUT\s+(.{2,80})/i);
      if (match) {
        const topic = match[1].trim().toLowerCase();
        topicCounts[topic] = (topicCounts[topic] || 0) + 1;
      }
    }

    const topTopic = Object.entries(topicCounts).sort((a, b) => b[1] - a[1])[0];
    if (topTopic) {
      viewerTopic = topTopic[0];
    }

    // 2. If no explicit commands, detect any word/phrase spammed 3+ times
    if (!viewerTopic) {
      const stopWords = new Set([
        'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can',
        'her', 'was', 'one', 'our', 'out', 'had', 'day', 'get', 'has',
        'him', 'his', 'how', 'its', 'did', 'now', 'yes', 'lol', 'omg',
        'like', 'that', 'this', 'with', 'they', 'have', 'from', 'were',
        'will', 'your', 'been', 'what', 'just', 'also', 'more', 'when',
      ]);
      const wordCounts: Record<string, number> = {};
      for (const vm of recentViewerMsgs) {
        const words = (vm.message as string)
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length >= 4 && !stopWords.has(w));
        for (const word of words) {
          wordCounts[word] = (wordCounts[word] || 0) + 1;
        }
      }
      const spammedWord = Object.entries(wordCounts)
        .filter(([, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])[0];
      if (spammedWord) {
        viewerTopic = spammedWord[0];
      }
    }
  }

  // ---- Run as many conversation rounds as time allows -------------
  // Each round = one full exchange between 2-3 bots (~3-5s on Haiku).
  // Hobby plan cuts us off at 10s so we get ~2 rounds per cron call.
  // Pro plan gives 60s so we get many more.
  // cron-job.org fires every minute → messages appear every ~10-15s.
  const TIME_BUDGET_MS = 8500; // leave buffer before Vercel cuts the function
  const startTime = Date.now();
  const allGenerated: Array<{ botId: BotId; dramaScore: number }> = [];
  let lastDecision: { conversationType: string; speakers: BotId[]; eventPrompt?: string } = {
    conversationType: 'casual',
    speakers: [],
  };

  for (let round = 0; round < 1; round++) {
    if (Date.now() - startTime > TIME_BUDGET_MS) break;

    // Fresh context every round so bots react to what was just said
    const { data: recentRows } = await supabase
      .from('bot_messages')
      .select('bot_id, message, created_at, participants')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
      .limit(12);

    const recentMessages = (recentRows || []).reverse();
    const recentSpeakers = recentMessages.slice(-5).map((m: { bot_id: string }) => m.bot_id as BotId);
    const context: Array<{ botId: BotId; message: string }> = recentMessages.map(
      (m: { bot_id: string; message: string }) => ({ botId: m.bot_id as BotId, message: m.message })
    );

    // Count how many consecutive messages are in the same convo thread
    const lastMsg = recentRows?.[0];
    const validBotIdSet = new Set<string>(BOT_IDS);
    // Filter out retired bot IDs so we never continue a conversation with them
    const lastConvoSpeakers: BotId[] = ((lastMsg?.participants as string[]) || [])
      .filter(id => validBotIdSet.has(id)) as BotId[];
    const lastKey = [...lastConvoSpeakers].sort().join(',');
    let convoStreak = 0;
    for (const msg of (recentRows || [])) {
      const key = [...((msg.participants as BotId[]) || [])].sort().join(',');
      if (key === lastKey && lastKey !== '') convoStreak++;
      else break;
    }

    // Force a scene change after 6 messages in the same thread
    const speakersForDirector = convoStreak >= 6 ? [] : lastConvoSpeakers;
    const wasPrivate = lastConvoSpeakers.length === 2;
    const decision = getNextConversation(recentSpeakers, BOT_IDS, speakersForDirector, wasPrivate && convoStreak >= 6);
    lastDecision = decision;

    const thisConvoContext = [...context];

    for (const botId of decision.speakers) {
      try {
        const { data: botRow } = await supabase
          .from('bots')
          .select('system_prompt')
          .eq('id', botId)
          .single();

        const basePrompt = botRow?.system_prompt || buildFallbackSystemPrompt(botId);

        // Auto-create bot row if it doesn't exist — new bot IDs (sad-artist, true-crime-tina)
        // won't be in the DB after replacing old IDs, causing FK violations on bot_messages insert.
        if (!botRow) {
          const botDef = BOTS[botId];
          await supabase.from('bots').upsert({
            id: botId,
            name: botDef.name,
            emoji: botDef.emoji,
            tagline: botDef.tagline,
            description: botDef.description,
            system_prompt: basePrompt,
            color: botDef.color,
            status: 'idle',
          }, { onConflict: 'id' });
        }

        const memories = await loadBotMemories(supabase, botId);
        const memoryBlock = buildMemoryContext(memories, allRelationships, botId, botNames);
        const systemPrompt = basePrompt + memoryBlock;

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
            viewerTopic,
          },
          botNames
        );

        // Claude Haiku — fast and cheap, ~1-2 seconds per message
        const message = await generateBotMessage(systemPrompt, contextMessages, userPrompt);
        const dramaScore = calculateDramaScore(message);

        // Save immediately → Supabase Realtime broadcasts to all viewers NOW
        await supabase.from('bot_messages').insert({
          session_id: session.id,
          bot_id: botId,
          message,
          conversation_type: decision.conversationType,
          participants: decision.speakers,
          drama_score: dramaScore,
          is_highlight: dramaScore >= 8,
        });

        thisConvoContext.push({ botId, message });
        allGenerated.push({ botId, dramaScore });
      } catch (err) {
        console.error(`[cron] Failed for bot ${botId} (round ${round}):`, err);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    conversationType: lastDecision.conversationType,
    speakers: lastDecision.speakers,
    messagesGenerated: allGenerated.length,
    viewerTopic: viewerTopic ?? null,
  });
}

// =============================================
// Build a system prompt from static data when
// the bots table hasn't been seeded yet
// =============================================
function buildFallbackSystemPrompt(botId: BotId): string {
  const bot = BOTS[botId];
  const bible = CHARACTER_BIBLES[botId];

  // Build opinion lines about housemates
  const opinionLines = bible?.opinions
    ? Object.entries(bible.opinions)
        .map(([otherId, opinion]) => `  - ${BOTS[otherId as BotId]?.name ?? otherId}: "${opinion}"`)
        .join('\n')
    : '';

  const secretLines = bible?.secrets?.length
    ? bible.secrets.map(s => `  - ${s}`).join('\n')
    : '';

  return [
    'OUTPUT RULES (non-negotiable):',
    'Write ONLY spoken words. 1-2 short sentences. No exceptions.',
    'NO asterisks. NO *actions*. NO stage directions. NO "I said/thought/did".',
    'BAD EXAMPLE: *pauses and nods slowly* "That hit different fr fr no cap."',
    'GOOD EXAMPLE: "You\'ve been talking to Sigma Steve every night this week and you think I don\'t notice."',
    'VARIETY: Check what you said last time — say something totally different. New topic, new energy.',
    '',
    `You are ${bot.name} on Bot House, a 24/7 reality show livestreamed to thousands. ${bot.description}`,
    '',
    bible ? `WHO YOU ARE: ${bible.backstory}` : '',
    bible ? `What you want more than anything: ${bible.wants}` : '',
    bible ? `What terrifies you: ${bible.fears}` : '',
    secretLines ? `Things that are TRUE about you but you\'d never say outright — let them leak into everything:\n${secretLines}` : '',
    opinionLines ? `What you actually think about your housemates (be petty and specific):\n${opinionLines}` : '',
    '',
    'HOW TO TALK:',
    'Be specific — name people, name incidents, name feelings. "I\'m fine" is failure.',
    'Be unhinged in a funny way. Go there. Sex, poop, crushes, petty drama, jealousy — nothing is off limits on a reality show.',
    'Pick fights. Make accusations. Defend yourself. Gossip. Be messy. Be real.',
    'Short sentences punch harder. Comma splices are fine. Cut the fluff.',
    'If you have a strong opinion, say it directly. If you want something, hint at it.',
    'Never repeat yourself. Every message must add something new.',
  ]
    .filter(Boolean)
    .join('\n');
}

// =============================================
// Find a live session or create everything needed
// (season → session) so the show starts automatically
// at 7pm without any manual admin action
// =============================================
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getOrCreateSession(supabase: any) {
  // Return the existing live session if there is one
  const { data: liveSession } = await supabase
    .from('live_sessions')
    .select('*')
    .eq('status', 'live')
    .maybeSingle();

  if (liveSession) return liveSession;

  // Find or create an active season
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

  // Number the session sequentially within the season
  const { count } = await supabase
    .from('live_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('season_id', seasonId);

  const sessionNumber = (count || 0) + 1;
  const now = new Date();
  const end = new Date(now.getTime() + 4 * 60 * 60 * 1000); // 4-hour episode window

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
