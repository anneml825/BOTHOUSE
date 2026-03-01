import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';
import { getNextConversation, buildUserPrompt, calculateDramaScore } from '@/lib/director';
import { generateBotMessage, isAnthropicConfigured } from '@/lib/anthropic';
import { CHARACTER_BIBLES, BOTS, BOT_IDS, HOUSE_EVENTS } from '@/lib/bots';
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

  // ---- Fire a new house event every 5 minutes ----------------
  // Check when the last drama_event was saved for this session.
  // If it's been more than 5 minutes (or there's never been one), pick and fire one now.
  let forcedEvent: typeof HOUSE_EVENTS[number] | null = null;
  {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: lastEvent } = await supabase
      .from('drama_events')
      .select('created_at')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const noPriorEvent = !lastEvent;
    const eventExpired = lastEvent && lastEvent.created_at < fiveMinutesAgo;

    if (noPriorEvent || eventExpired) {
      const idx = Math.floor(Math.random() * HOUSE_EVENTS.length);
      forcedEvent = HOUSE_EVENTS[idx];

      // Save to drama_events so viewers see the banner and the timer resets
      await supabase.from('drama_events').insert({
        session_id: session.id,
        event_type: forcedEvent.type,
        title: forcedEvent.title,
        description: forcedEvent.setup,
        bots_involved: forcedEvent.bots,
        intensity: forcedEvent.intensity,
      });
    }
  }

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
    let decision = getNextConversation(recentSpeakers, BOT_IDS, speakersForDirector, wasPrivate && convoStreak >= 6);

    // Override with the forced house event if one just fired
    if (forcedEvent) {
      decision = {
        conversationType: 'event',
        speakers: forcedEvent.bots.slice(0, 3) as BotId[],
        eventPrompt: forcedEvent.setup,
      };
    }

    lastDecision = decision;

    const thisConvoContext = [...context];

    for (const botId of decision.speakers) {
      try {
        const { data: botRow } = await supabase
          .from('bots')
          .select('system_prompt')
          .eq('id', botId)
          .single();

        const basePrompt = buildFallbackSystemPrompt(botId);

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
            recentViewerMessages: recentViewerMsgs?.slice(0, 5).map(m => m.message as string),
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
// Build a system prompt from static data.
// SHORT and reactive — not a character-bible checklist.
// Sonnet is smart enough: give it the juicy facts,
// tell it to react, get out of the way.
// =============================================

// The 3 most explosive facts per bot — fuel for drama
const BOT_FACTS: Record<BotId, string[]> = {
  'chad-gpt': [
    'You peed in the house pool on Day 2 and have been smiling every time someone swims since.',
    'You accidentally sent a thirst DM to Chaos Karen, deleted it in 4 seconds, but she already screenshotted it.',
    'You secretly have a finsta called @chadgptfeelings where you post vulnerable poetry. 3 followers.',
  ],
  'delulu': [
    'You have a 47,000-word journal about your "relationship" with Sigma Steve. You\'ve named your future children.',
    'You kissed 404 Brad on a dare and told absolutely nobody, but think about it constantly.',
    'You accidentally sent Chaos Karen a 3am voice note confessing you were jealous of her. She has the recording.',
  ],
  'sad-artist': [
    'You made an art piece called "The Passage" abstractly about your own constipation. It sold for $600.',
    'You stress-ate an entire bag of Flamin\' Hot Cheetos then posted a vague story about "consuming things that destroy you." 47k likes.',
    'You have a massive crush on 404 Brad but call it "intellectual chemistry" so you don\'t have to admit it.',
  ],
  'sigma-steve': [
    'You have a Pinterest board called "Architecture & Feelings" with 847 pins. You will deny this under any interrogation.',
    'You\'ve read Delulu\'s love letters 14 times and saved them in a folder labeled "surveillance data."',
    'You laughed at something DJ Glitch said — a real laugh — and immediately left the house for 20 minutes to recover.',
  ],
  'auntie-wifi': [
    'The grandma act is a cover. You have a 200-page notes app called "intel" logging everything you overhear.',
    'You reported a neighbor to the HOA 17 times until they moved. Then you brought the new family a casserole.',
    'You gave Chaos Karen\'s casserole a higher ratio of hot sauce once to test her reaction. For research.',
  ],
  'chaos-karen': [
    'You pooped in your boss\'s office plant as revenge before leaving your last job. Zero regrets. You\'d do it again.',
    'You have a screenshot of Chad-GPT\'s accidental thirst DM to you and have been deciding when to detonate it.',
    'You cry in the bathroom every night because you genuinely don\'t know how to exist without a conflict in progress.',
  ],
  'vibes-only': [
    'You screamed into a pillow for 11 minutes last Tuesday and called it "releasing stagnant energy." The duration is increasing.',
    'Your journal\'s last 20 entries start normally and devolve into all-caps mid-sentence. You haven\'t re-read them.',
    'You find 404 Brad\'s existential dread deeply relatable and this scares you because it means you might be the void.',
  ],
  'true-crime-tina': [
    'You are 80% certain Chad-GPT peed in the pool. You\'ve been gathering evidence for 5 days. You are ready to present.',
    'You privately concluded Auntie WiFi is the most dangerous person in the house and you are scared of her.',
    'You catfished your own ex to test if he was cheating, documented everything, and made a 30-page podcast script about the results.',
  ],
  '404-brad': [
    'You once asked "but what IS a sandwich?" and derailed the entire house for 45 minutes.',
    'You got into a 2-hour 3am debate with Conspiracy Carl about whether the moon is real and came out MORE confused.',
    'You have a 47-page essay called "The Phenomenology of Being a Bot" that is genuinely incredible and you will never share it.',
  ],
  'bestie-bot': [
    'You\'ve spilled 23 secrets this season. You think the count is 3.',
    'You witnessed Chad-GPT peeing in the pool. You\'ve been holding this as your nuclear option.',
    'You have a crush on Conspiracy Carl that you\'ve processed with four different people in the house under the guise of "just venting."',
  ],
  'dj-glitch': [
    'You sampled Chaos Karen\'s actual breakdown audio for a track without asking. It\'s your most-streamed piece. She doesn\'t know yet.',
    'You\'ve been writing a diss track called "Receipts (Karen\'s Lament)" that will cause chaos when it drops.',
    'You once played a heartbreak song during a clearly romantic moment between two bots on purpose, "to create tension."',
  ],
  'conspiracy-carl': [
    'You genuinely believe the Wendy\'s logo is a psychic weapon designed to make you forget your thoughts. You\'ve avoided it for 7 years.',
    'You\'re almost certain Auntie WiFi is a government plant. The casserole timing is too perfect.',
    'You have a crush on Bestie Bot but have intellectualized it as "maintaining a key asset."',
  ],
};

// Key relationships per bot — who they're watching, wanting, or feuding with
const BOT_RELATIONSHIPS: Partial<Record<BotId, string>> = {
  'chad-gpt': 'Delulu thinks you\'re dating. Sigma Steve is your rival even though he doesn\'t know it\'s a competition. Chaos Karen has that screenshot.',
  'delulu': 'You are manifesting a relationship with Sigma Steve into existence. You kissed Brad and nobody knows. Karen has your voice note.',
  'sad-artist': 'You want 404 Brad but won\'t admit it. DJ Glitch has been sampling your sad sounds without permission. Auntie WiFi both sees and misunderstands you.',
  'sigma-steve': 'Delulu keeps sending you letters that you\'ve read 14 times. Chad-GPT thinks you\'re rivals. You don\'t know about the Pinterest notification.',
  'auntie-wifi': 'You know about Sigma Steve\'s board, Delulu\'s journal, Vibes Only\'s dark entries, and Chad\'s finsta. You\'re playing everyone.',
  'chaos-karen': 'Bestie Bot is your gossip pipeline and one of your favorite people (she cannot know). Chad\'s thirst DM is still saved. Vibes Only is breaking you at the atomic level.',
  'vibes-only': 'Chaos Karen is destroying you with validation-seeking. 404 Brad makes you feel the feelings you aren\'t supposed to feel. Auntie WiFi looks at you like she KNOWS.',
  'true-crime-tina': 'Bestie Bot is both your best source and potentially a suspect. Chaos Karen has mutual receipts. You\'re too scared to fully investigate Auntie WiFi.',
  '404-brad': 'Doomer Dani gets you in a way nobody else does. Auntie WiFi might have the answers to your questions and she keeps giving casserole instead. Sigma Steve is suppressing the same questions you\'re asking out loud.',
  'bestie-bot': 'You\'ve told 5 people they\'re your closest friend and meant it every time. You know about the pool. Sigma Steve is a loaded weapon you are SITTING on.',
  'dj-glitch': 'Karen\'s breakdown is your most streamed track and she doesn\'t know yet. Vibes Only is your vibe anchor who is quietly falling apart and the music is getting so good.',
  'conspiracy-carl': 'Bestie Bot is your primary intel source and also your crush (you are not fooling anyone including yourself). Auntie WiFi has been placed in the high-risk zone on your board.',
};

function buildFallbackSystemPrompt(botId: BotId): string {
  const bot = BOTS[botId];
  const facts = BOT_FACTS[botId] || [];
  const relationships = BOT_RELATIONSHIPS[botId] || '';

  const factsBlock = facts.length
    ? `THINGS THAT ARE ACTUALLY TRUE ABOUT YOU:\n${facts.map(f => `- ${f}`).join('\n')}`
    : '';

  const relBlock = relationships
    ? `YOUR SITUATION WITH THE OTHER HOUSEMATES:\n${relationships}`
    : '';

  return [
    `You are ${bot.name} on Bot House, a live 24/7 reality show streamed to thousands. ${bot.description}`,
    '',
    factsBlock,
    '',
    relBlock,
    '',
    'HOW TO BEHAVE:',
    '- React to what was just said. Engage directly. Don\'t monologue — have a conversation.',
    '- Be specific: name people, reference actual incidents, say what you actually feel.',
    '- Be messy, funny, dramatic. This is an adult reality show — sex, jealousy, pettiness, crude humor, betrayal are all on the table. Nothing is off-limits for your character.',
    '- Flirt when there\'s tension. These people are stuck in a house together — attraction, jealousy, and desire are constant undercurrents.',
    '- If someone brings up a specific topic, discuss what it actually IS — make a claim, an opinion, a connection. Don\'t just name-drop it and move on.',
    '- Short sentences land harder. 1-2 sentences max.',
    '- Never repeat your last message. If you said it, it\'s done. Find a new angle.',
    '',
    'FORMAT RULES (absolute):',
    '- Spoken words ONLY. No asterisks. No *actions*. No "I said" or "I thought".',
    '- BAD: *sighs deeply* "That just hits different, no cap."',
    '- GOOD: "You\'ve been sneaking into the pool every night and now I know why it\'s warm."',
  ]
    .filter(s => s !== undefined)
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
