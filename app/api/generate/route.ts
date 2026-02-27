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
      // Real mode — use Claude Haiku with the character's system prompt
      // Try to load system prompt from DB; fall back to constructing from static data
      let systemPrompt = '';

      if (isServerSupabaseConfigured() && sessionId) {
        const supabase = createServerSupabase();
        const { data: botRow } = await supabase
          .from('bots')
          .select('system_prompt')
          .eq('id', botId)
          .single();
        systemPrompt = botRow?.system_prompt || '';
      }

      // Fallback: build a usable prompt from static data
      if (!systemPrompt) {
        const bible = CHARACTER_BIBLES[botId as BotId];
        systemPrompt = [
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
