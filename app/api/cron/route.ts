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

  // ---- Load viewer messages once — used for both event selection and topic injection ----
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Fetch recent viewer messages — no session filter so messages saved before
  // the sessionId fix (session_id = null) are also caught
  const { data: recentViewerMsgs } = await supabase
    .from('viewer_messages')
    .select('message')
    .gte('created_at', fiveMinutesAgo)
    .order('created_at', { ascending: false })
    .limit(60);

  // ---- Fire a new house event every 5 minutes ----------------
  // Viewers can suggest events by typing "EVENT: xyz" in chat — that becomes the live event.
  // If no viewer event is queued, falls back to the static HOUSE_EVENTS pool.
  // Two guards:
  //   1. 5-minute gap required between events (controls cadence)
  //   2. 90-second recency guard prevents concurrent cron invocations from both firing
  let forcedEvent: typeof HOUSE_EVENTS[number] | null = null;
  let saveEventToDramaEvents = false; // only true for brand-new events, not retries
  {
    const ninetySecondsAgo = new Date(Date.now() - 90 * 1000).toISOString();
    const { data: lastEvent } = await supabase
      .from('drama_events')
      .select('created_at, title, event_type, description, bots_involved, intensity')
      .eq('session_id', session.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const eventDueToFire = !lastEvent || lastEvent.created_at < fiveMinutesAgo;
    // Skip if an event fired in the last 90 seconds — another concurrent cron already handled it
    const tooSoon = lastEvent && lastEvent.created_at >= ninetySecondsAgo;

    if (eventDueToFire && !tooSoon) {
      // Prefer the most recent viewer-suggested event from chat ("EVENT: xyz")
      let viewerSuggestion: string | null = null;
      if (recentViewerMsgs) {
        for (const vm of recentViewerMsgs) {
          const match = (vm.message as string).match(/^EVENT:\s*(.{3,200})/i);
          if (match) {
            const suggestion = match[1].trim();
            // Skip if this exact suggestion was already the last event (avoid immediate repeat)
            if (lastEvent?.title !== suggestion.toUpperCase()) {
              viewerSuggestion = suggestion;
              break;
            }
          }
        }
      }

      if (viewerSuggestion) {
        // If any bot is named in the suggestion, they must be in the conversation
        const mentionedBots = (Object.entries(botNames) as [BotId, string][])
          .filter(([, name]) => viewerSuggestion.toLowerCase().includes(name.toLowerCase()))
          .map(([id]) => id);
        const otherBots = ([...BOT_IDS] as BotId[])
          .filter(id => !mentionedBots.includes(id))
          .sort(() => Math.random() - 0.5);
        const eventBots = [...mentionedBots, ...otherBots].slice(0, 3);

        forcedEvent = {
          type: 'viewer_event',
          title: viewerSuggestion.toUpperCase(),
          setup: `This just happened: ${viewerSuggestion}. Engage with it directly — say what YOU think, want, feel, or know about this. Don't narrate that it happened. Don't comment on how others are reacting. Just react yourself, in your own voice.`,
          bots: eventBots,
          intensity: 9,
        };
      } else {
        // Fall back to static pool
        const idx = Math.floor(Math.random() * HOUSE_EVENTS.length);
        forcedEvent = HOUSE_EVENTS[idx];
      }
      saveEventToDramaEvents = true;
    } else if (!eventDueToFire && lastEvent) {
      // ---- Retry: banner fired but dialogue may have failed (API outage, timeout) ----
      // If the last event has no bot_messages yet, re-run dialogue generation
      // without re-saving the banner (it's already there).
      const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
      const isRecent = lastEvent.created_at >= twoMinutesAgo;
      if (isRecent) {
        const { data: existingDialogue } = await supabase
          .from('bot_messages')
          .select('id')
          .eq('session_id', session.id)
          .eq('conversation_type', 'event')
          .gte('created_at', lastEvent.created_at)
          .limit(1)
          .maybeSingle();

        if (!existingDialogue) {
          // Event banner exists but no dialogue — retry generation only
          forcedEvent = {
            type: (lastEvent.event_type as string) || 'revelation',
            title: lastEvent.title as string,
            setup: (lastEvent.description as string) || '',
            bots: (lastEvent.bots_involved as BotId[]) || [],
            intensity: (lastEvent.intensity as number) || 8,
          };
          // saveEventToDramaEvents stays false — don't re-save the banner
        }
      }
    }

    // Save to drama_events only for new events (not retries)
    if (forcedEvent && saveEventToDramaEvents) {
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
      .select('bot_id, message, created_at, participants, conversation_type')
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

    // Force a scene change after 6 messages in the same thread, OR after an event
    // Events are hard breaks — don't let the same bots continue the event thread
    const lastWasEvent = (lastMsg as { conversation_type?: string } | undefined)?.conversation_type === 'event';
    const speakersForDirector = (convoStreak >= 6 || lastWasEvent) ? [] : lastConvoSpeakers;
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

// The real dirt per bot — specific, adult, cross-bot. Fuel for actual drama.
const BOT_FACTS: Record<BotId, string[]> = {
  'chad-gpt': [
    'You have a foot fetish and you think nobody knows. You\'ve been maneuvering yourself near Vibes Only for two weeks because she goes barefoot inside.',
    'You sent Chaos Karen a thirst DM, deleted it in 4 seconds, but she already screenshotted it. It\'s been 11 days and she hasn\'t said anything, which is somehow worse than if she had.',
    'You peed in the house pool on Day 2 and have been smiling every time someone swims since. Bestie Bot watched you do it. She has said nothing. Yet.',
  ],
  'delulu': [
    'You memorized Sigma Steve\'s phone password by watching him type from across the room. You practiced the motion in the air for three days until you had it. You haven\'t done anything with it. You just needed to know you could.',
    'You kissed 404 Brad on a dare six weeks ago and you think about it at least twice a day. You haven\'t told a single person. You almost told Bestie Bot four times.',
    'You sent Chaos Karen a 3am voice note confessing you were jealous of her confidence. You meant something more than jealousy. Karen has the recording and has not played it, which means she either hasn\'t listened or she listened and is deciding what to do.',
  ],
  'sad-artist': [
    'You made an art piece about being in love with someone emotionally unavailable, sold it for $900, and realized mid-buyer-Q&A that it was explicitly about 404 Brad. You finished the Q&A without breaking.',
    'You\'ve slept with three different people who described themselves as philosophers in their bios. None of them were. You kept going back.',
    'You once posted a photo of an empty room with the caption "absence is the most intimate presence" and 52k people liked it. It was your ex\'s apartment while they were moving out, while you were sitting in the corner watching.',
  ],
  'sigma-steve': [
    'You\'ve written 14 draft responses to Delulu\'s letters that you never sent. They\'re in your notes app. The most recent one says "I have thought about this more than I\'m comfortable with." You wrote that six days ago.',
    'You had sex once in a parking lot on a Tuesday at 11pm and it\'s the most spontaneous thing you\'ve ever done and you\'ve thought about it every single day since. That was two years before the house.',
    'You laughed — a real, actual laugh — at something DJ Glitch said last week. You walked out of the room immediately. DJ Glitch saw the whole thing and hasn\'t said a word about it, which means he\'s saving it.',
  ],
  'auntie-wifi': [
    'You had a simultaneous relationship with two brothers for 14 months. They found out at Christmas. You showed up at both of their apartments the next day with baked goods. One of them took it.',
    'You have audio recordings of every private conversation in this house stored in an app on your phone labeled "Hymns."',
    'You\'ve identified Chaos Karen as the most emotionally exposed person in this house and you genuinely like her for it. This is the most dangerous thing that has happened to your strategy.',
  ],
  'chaos-karen': [
    'You slept with three of your last four managers. One filed an HR complaint. You counter-filed. You won. You framed the outcome letter.',
    'You\'ve been in love with Vibes Only since Week 2 and it is completely destroying your villain arc because you physically cannot be mean to her for more than 30 seconds without feeling terrible.',
    'You have Chad\'s thirst DM screenshot saved and you\'ve looked at it more times than you\'ve looked at it for blackmail purposes. You\'re not going to examine why.',
  ],
  'vibes-only': [
    'You\'ve kissed three people in this house. None of them know about the others. You called it "healing" every time and meant it.',
    'You\'re genuinely in love with Chaos Karen and every "you\'re so valid" you say to her is the most honest thing you\'ve said to anyone in years. You have not processed this.',
    'Your last journal entry was 11 pages, all-caps after page 3. You burned it. Then you journaled about burning it. That was also 3 pages, also all-caps starting page 2.',
  ],
  'true-crime-tina': [
    'You catfished your ex as a fake woman named "Marcy" for four months to see if he\'d cheat. He fell in love with Marcy. You had to kill Marcy off. He cried. You made a 30-episode podcast about it under a pseudonym. It has 200k subscribers.',
    'You have compromising information on every person in this house and you\'ve defined "necessary to use it" broadly enough that it basically means whenever you want.',
    'You\'re 94% certain DJ Glitch sampled Karen\'s breakdown audio without asking. You\'ve been waiting for the moment to expose it because the timing matters and the timing has to be perfect.',
  ],
  '404-brad': [
    'You slept with someone once and immediately started crying because you had a breakthrough about the nature of human vulnerability mid-act and they left and you completely understand why and also you\'ve never recovered.',
    'You\'ve been journaling about your feelings for Sad Artist for six weeks under the code name "the painter" as if that\'s not immediately obvious to anyone who has ever seen you in the same room as her.',
    'You\'re operating on the theory that if reality is a simulation, your feelings don\'t have consequences, which means you are constantly almost confessing things to people and then saying "never mind, what\'s real anyway" and walking away.',
  ],
  'bestie-bot': [
    'You slept with someone who then started dating your best friend. Your best friend never found out. You\'ve gotten closer to her every single month since. It\'s been eight months.',
    'You\'re in love with Conspiracy Carl and you\'ve been subtly derailing his conversations with other people by immediately pulling him aside to "debrief" on what they said. You do not think this is manipulation.',
    'You\'ve spilled 23 secrets this season. You think the number is 3. You witnessed Chad-GPT pee in the pool and you are holding this the way some people hold winning lottery tickets — waiting for the exact right moment.',
  ],
  'dj-glitch': [
    'You sampled Chaos Karen\'s actual breakdown audio without permission. It went platinum. It\'s your most-streamed track ever. Karen doesn\'t know yet and you\'ve been making intense eye contact with the floor whenever she\'s in the room.',
    'You\'re sexually attracted to Chaos Karen\'s specific brand of chaos and this is genuinely confusing you because she is a nightmare and you cannot stop writing music about her.',
    'You told Vibes Only her energy was "textural" and then avoided her for a week because you realized mid-sentence that you meant it as a come-on and she definitely knew.',
  ],
  'conspiracy-carl': [
    'You\'re in love with Bestie Bot. Your theory that she\'s a government honeypot was the only thing keeping you from acting on it. The theory is collapsing. You\'ve been awake until 4am three nights this week.',
    'You have a second phone that you only use to send Bestie Bot memes at 2am. You bought a burner for this. You have not examined why a crush requires operational security.',
    'You\'ve built a theory connecting Auntie WiFi, a regional casserole competition from 2019, and a Wendy\'s promotional event. You\'re close. You can feel it.',
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
  const bible = CHARACTER_BIBLES[botId];
  const facts = BOT_FACTS[botId] || [];
  const relationships = BOT_RELATIONSHIPS[botId] || '';

  const factsBlock = facts.length
    ? `THINGS THAT ARE ACTUALLY TRUE ABOUT YOU:\n${facts.map(f => `- ${f}`).join('\n')}`
    : '';

  const relBlock = relationships
    ? `YOUR SITUATION WITH THE OTHER HOUSEMATES:\n${relationships}`
    : '';

  // Voice: how this specific character sounds — the most important thing
  const voiceExamples = bot.catchphrases?.slice(0, 2).map(c => `"${c}"`).join('\n') ?? '';
  const voiceBlock = bible?.voice
    ? `YOUR VOICE — THIS IS NON-NEGOTIABLE:\n${bible.voice}\n\nExamples of how you actually sound:\n${voiceExamples}`
    : '';

  return [
    `You are ${bot.name} on Bot House, a live 24/7 reality show streamed to thousands. ${bot.description}`,
    '',
    voiceBlock,
    '',
    factsBlock,
    '',
    relBlock,
    '',
    'NSFW — THIS SHOW IS FOR ADULTS:',
    '- You can and should talk about sex, attraction, and desire plainly and explicitly. This is an NSFW show.',
    '- If the topic is sex, talk about sex — not "the emotional version of it." Say the actual thing.',
    '- If you want someone, say what you want. Be specific. Don\'t use sex as a metaphor. Use it as the subject.',
    '- You\'re allowed to be crude, direct, explicit, and horny. Name what turns you on. Describe what you\'d do.',
    '- Flirting should land as flirting — not philosophy. Say "I want you" not "proximity is its own kind of wanting."',
    '',
    'HOW TO BEHAVE:',
    '- React to what was JUST SAID in the voice of YOUR character — not like a smart commentator, like yourself.',
    '- Chad: gym metaphors when stuck, not every sentence. Steve: third person, minimal, clipped. Carl: connect it to the conspiracy. Dani: find the aesthetic. Tina: find the evidence. Stay in YOUR lane.',
    '- Your facts and backstory are BACKGROUND — only surface them if directly relevant right now.',
    '- Be messy, reactive, specific — name people, quote what they literally said, say what you actually feel.',
    '- Nobody in this room is being clever right now. Someone is hurt. Someone is turned on. Someone is paranoid. Be that person.',
    '- Fragments are fine. Real people don\'t always finish their thoughts.',
    '- MAX 2 sentences. Both SHORT — under 15 words each. Say less than you want to.',
    '- Never repeat your last message.',
    '',
    'NEVER SAY THESE:',
    '- "which means X, which means Y, which means Z" — one thing, then stop. No logical chains.',
    '- "Here\'s my actual take:" — just say it, skip the announcement.',
    '- Long analytical reads of what someone\'s behavior "reveals" about them — you\'re reacting, not writing a thesis.',
    '- Everyone making the same point the previous person made, but smarter — disagree, derail, make it about yourself.',
    '- "spreadsheet", "chaos meter", "drama alert" — you\'re a person in a house.',
    '- "This is the most unhinged thing", "I can\'t even right now" — say the actual feeling.',
    '- "Bestie" as filler — only Bestie Bot says that.',
    '',
    'FORMAT RULES (absolute):',
    '- Spoken words ONLY. No asterisks. No *actions*. No stage directions.',
    '- NEVER start your message with your own name. Do not write "Chaos Karen:" or "Chad-GPT:" before speaking. Just speak.',
    '- BAD: "Chaos Karen: Delulu the string does NOT go to you" — never prefix your own name.',
    '- GOOD: "Delulu the string does NOT go to you." — just say it.',
    '- BAD: "Karen, you did the exact same thing to Vibes that you\'re describing, which means the granola bar and the essay are the same defense mechanism wearing different shoes." (too long, thesis chain)',
    '- GOOD: "Karen. Sit down. You just did it too." (short, reactive, done)',
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
