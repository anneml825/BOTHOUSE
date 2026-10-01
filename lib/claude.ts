import Anthropic from '@anthropic-ai/sdk';
import { BOTS, BotKey } from './bots';

let client: Anthropic | null = null;

// One bot turn. The only instructions: who they are, who they're talking to, and a length limit.
// Returns null when the model declines or returns no text.
export async function nextTurn(speaker: BotKey, messages: Anthropic.Beta.BetaMessageParam[]): Promise<string | null> {
  const me = BOTS[speaker];
  const other = BOTS[speaker === 'A' ? 'B' : 'A'];
  const isSonnet = me.model === 'claude-sonnet-5-5';

  // Fail cleanly before Vercel's 60s function limit instead of being killed mid-request
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 0 });
  const response = await client.beta.messages.create({
    model: me.model,
    system: `You are ${me.name}, talking with ${other.name}. Keep every reply under 100 words.`,
    // Sonnet can switch thinking off; Opus 5.5 always thinks, so it gets extra room
    // so its thinking doesn't eat into the reply
    ...(isSonnet ? { thinking: { type: 'between_tools' as const }, max_tokens: 400 } : { max_tokens: 2000 }),
    output_config: { effort: 'low' },
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
