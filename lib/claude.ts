import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

// One bot turn. No system prompt — the model only sees the conversation.
// Returns null when the model declines or returns no text.
export async function nextTurn(messages: Anthropic.Beta.BetaMessageParam[]): Promise<string | null> {
  // Fail cleanly before Vercel's 60s function limit instead of being killed mid-request
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 0 });
  const response = await client.beta.messages.create({
    model: 'claude-sonnet-5-5',
    // Keeps each reply short enough to finish well inside the 60s function limit
    max_tokens: 1200,
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
