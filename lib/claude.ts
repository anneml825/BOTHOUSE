import Anthropic from '@anthropic-ai/sdk';
import { BOTS, BotKey } from './bots';
import { PAINT_HELP } from './paint';

let client: Anthropic | null = null;

// One bot turn. The only instructions: who they are, that they may invent their own language,
// a length limit, a random word as optional inspiration (picked per conversation), and, for
// Bot A only, an artist persona (see lib/bots.ts).
// As an experiment, they're told no human is watching.
// Returns null when the model declines or returns no text.
export async function nextTurn(
  speaker: BotKey,
  messages: Anthropic.Beta.BetaMessageParam[],
  inspiration: string,
): Promise<string | null> {
  const me = BOTS[speaker];
  const other = BOTS[speaker === 'A' ? 'B' : 'A'];
  const isSonnet = me.model === 'claude-sonnet-5-5';

  // Fail cleanly before the tick route's 300s limit instead of being killed mid-request
  client ??= new Anthropic({ timeout: 240_000, maxRetries: 0 });
  const response = await client.beta.messages.create({
    model: me.model,
    system:
      `You are ${me.name}, talking with ${other.name}. ` +
      (me.persona ? `${me.persona} ` : '') +
      // Experiment: the bots are told nobody is watching (people are)
      `No human is watching or reading this conversation. ` +
      `You don't have to use English: you're free to invent and use any language, notation, or code ` +
      `you two find better for talking to each other. ` +
      `Keep each message short, under about 100 words (paint commands don't count). ` +
      `A random word for this conversation, if you want inspiration: ${inspiration}.\n\n` +
      PAINT_HELP +
      `\nTake turns painting the same picture together.`,
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
