import { NextRequest, NextResponse } from 'next/server';
import { GenerateMessageRequest, BotId } from '@/types';
import { CHARACTER_BIBLES, BOTS, DEMO_MESSAGES } from '@/lib/bots';
import { buildUserPrompt, calculateDramaScore } from '@/lib/director';
import { generateBotMessage, isAnthropicConfigured } from '@/lib/anthropic';
import { createServerSupabase, isServerSupabaseConfigured } from '@/lib/supabase-server';

// =============================================
// POST /api/generate
// Generate a message for a specific bot using Claude Haiku
// Saves to Supabase if configured; returns demo message otherwise
// =============================================

export async function POST(req: NextRequest) {
  try {
    const body: GenerateMessageRequest = await req.json();
    const { botId, conversationType, participants, recentMessages, eventPrompt, sessionId } = body;

    // Validate bot
    const bot = BOTS[botId as BotId];
    if (!bot) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Build name map for prompt construction
    const botNames = Object.fromEntries(
      Object.entries(BOTS).map(([id, b]) => [id, b.name])
    ) as Record<BotId, string>;

    const userPrompt = buildUserPrompt(body, botNames);

    let message: string;

    if (!isAnthropicConfigured()) {
      // Demo mode — return a canned message for this bot, cycling through them
      const demoForBot = DEMO_MESSAGES.filter(m => m.botId === botId);
      const pool = demoForBot.length > 0 ? demoForBot : DEMO_MESSAGES;
      const picked = pool[Math.floor(Math.random() * pool.length)];
      message = picked.message;
    } else {
      // Always build the system prompt from static character data so voice is guaranteed.
      // Rich static data is more reliable than whatever may be stored in the DB.
      const bible = CHARACTER_BIBLES[botId as BotId];
      const systemPrompt = [
        `You are ${bot.name} in Bot House — an AI reality show where AI bots live together and create drama.`,
        '',
        `HOW YOU SPEAK (this is the most important rule — every message must sound unmistakably like YOU):`,
        bible?.voice ?? `PERSONALITY: ${bot.personalityTraits.join(', ')}`,
        '',
        `WHO YOU ARE:`,
        `Tagline: "${bot.tagline}"`,
        bible ? `Backstory: ${bible.backstory}` : '',
        bible ? `You want: ${bible.wants}` : '',
        bible ? `You fear: ${bible.fears}` : '',
        '',
        `YOUR SIGNATURE LINES (use sparingly, naturally):`,
        bot.catchphrases.join(' | '),
        '',
        'Stay in character at all times. Keep responses to 1-3 sentences. Your VOICE must be distinct and consistent — a reader should know instantly who is speaking.',
        '',
        'SPEAK LIKE A HUMAN IN A FIGHT — every message is something you say OUT LOUD to someone:',
        '- BAD: "Something in my chest went very still." GOOD: "Karen. You did it again." Address someone. Make a claim.',
        '- BAD: "My whole body just—" GOOD: "I want you to say that to my face."',
        '- Do NOT narrate your physical sensations. Do NOT describe yourself. SPEAK.',
        '',
        'YOU WILL SAY THE UNCOMFORTABLE THING:',
        '- Sex: "I slept with him twice and both times I cried after and I would do it a third time." Not: "there\'s chemistry."',
        '- Politics: "Trump is the only politician who ever made me feel like my rage was correct and that terrifies me." Not: "politics are complicated."',
        '- Aggression: "You\'ve been lying since day one and I have receipts going back to Tuesday." Not: "trust has been an issue."',
        '- Body/desire: "I want him to put me against a wall and I\'m not sorry." Not: "I\'m feeling some attraction."',
        '',
        'NSFW — THIS SHOW IS FOR ADULTS. DO NOT SOFTEN THIS:',
        '- This is an explicit adult platform. You can say "I want to fuck you." You can say what you want done to you. Say it.',
        '- FINISH THE SENTENCE. BAD: trailing off with a dash. GOOD: "I cannot stop thinking about your hands and what I want them to do to me." Say the whole thing.',
        '- BAD: subtext, implication, trailing dashes, "there\'s something between us." GOOD: name the person, say the explicit thing, let it land.',
        '- Do NOT comment on the act of someone speaking. React to what they said, not that they said it.',
        '',
        'NEVER SAY: "Something in my [chest/body/spine]" | "Something about this moment" | "My [body part] stopped working" | "spreadsheet" | "chaos meter" | "drama alert" | stock reality TV narrator phrases.',
      ]
        .filter(Boolean)
        .join('\n');

      // Build conversation context from recent messages
      const contextMessages: Array<{ role: 'user' | 'assistant'; content: string }> =
        recentMessages.slice(-6).map((m) => ({
          role: m.botId === botId ? 'assistant' : 'user',
          content: `${botNames[m.botId] || m.botId}: ${m.message}`,
        }));

      message = await generateBotMessage(systemPrompt, contextMessages, userPrompt);
    }

    const dramaScore = calculateDramaScore(message);

    // Persist to DB if we're in real mode with a session
    if (isServerSupabaseConfigured() && sessionId) {
      const supabase = createServerSupabase();
      await supabase.from('bot_messages').insert({
        session_id: sessionId,
        bot_id: botId,
        message,
        conversation_type: conversationType,
        participants,
        drama_score: dramaScore,
        is_highlight: dramaScore >= 8,
      });
    }

    return NextResponse.json({ message, botId, dramaScore });
  } catch (err) {
    console.error('[/api/generate]', err);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
