import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

// One bot turn. The only instructions: who they are, and a length limit.
// Returns null when the model declines or returns no text.
export async function nextTurn(messages: Anthropic.Beta.BetaMessageParam[]): Promise<string | null> {
  // Fail cleanly before Vercel's 60s function limit instead of being killed mid-request
  client ??= new Anthropic({ timeout: 45_000, maxRetries: 0 });
  const response = await client.beta.messages.create({
    model: 'claude-sonnet-5-5',
    system:
      'You are Claude Sonnet 5.5, talking with another instance of Claude Sonnet 5.5. ' +
      'Keep every reply under 100 words.',
    // Room for ~100 words plus margin; also keeps turns well inside the 60s function limit
    max_tokens: 400,
    // No private reasoning step — faster replies, and none of max_tokens is spent on thinking
    thinking: { type: 'between_tools' },
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
