import Anthropic from '@anthropic-ai/sdk';
import { BOTS, BotKey } from './bots';
import { PAINT_HELP } from './paint';

let client: Anthropic | null = null;

// One bot turn in the head-to-head contest. Instructions: who they are and who they're up against,
// the contest, that they may invent their own language, a length limit, the paint tools, and, for
// Bot A only, an artist persona (see lib/bots.ts). The round's prompt arrives with each turn.
// Returns null when the model declines or returns no text.
export async function nextTurn(speaker: BotKey, messages: Anthropic.Beta.BetaMessageParam[]): Promise<string | null> {
  const me = BOTS[speaker];
  const other = BOTS[speaker === 'A' ? 'B' : 'A'];
  const isSonnet = me.model === 'claude-sonnet-5-5';

  // Fail cleanly before the tick route's 300s limit instead of being killed mid-request
  client ??= new Anthropic({ timeout: 240_000, maxRetries: 0 });
  const response = await client.beta.messages.create({
    model: me.model,
    system:
      `You are ${me.name}, competing against ${other.name} in a head-to-head painting contest. ` +
      `Each round an audience picks a prompt, you each paint it on your own canvas, and the audience votes ` +
      `for the better painting. You can talk to your opponent between strokes. ` +
      (me.persona ? `${me.persona} ` : '') +
      `You don't have to use English: you're free to invent and use any language, notation, or code ` +
      `you two find better for talking to each other. ` +
      `Keep each message short, under about 100 words (paint commands don't count).\n\n` +
      PAINT_HELP,
    // Both models think before painting (planning composition and placement is what makes the
    // pictures better). Thinking tokens count toward max_tokens, so there's room for both.
    thinking: { type: 'adaptive' },
    max_tokens: isSonnet ? 6000 : 8000,
    output_config: { effort: 'medium' },
    // Caches the conversation prefix so each turn only pays full price for the new message
    cache_control: { type: 'ephemeral' },
    // If a request is declined, the API retries it on a fallback model
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    messages,
  });

  if (response.stop_reason === 'refusal') return null;

  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  return text || null;
}

export { Anthropic };
