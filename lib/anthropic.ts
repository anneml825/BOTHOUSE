import Anthropic from '@anthropic-ai/sdk';

// =============================================
// ANTHROPIC CLIENT
// =============================================

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }
  return client;
}

export function isAnthropicConfigured(): boolean {
  return (
    !!process.env.ANTHROPIC_API_KEY &&
    process.env.ANTHROPIC_API_KEY !== 'placeholder-anthropic-key' &&
    process.env.ANTHROPIC_API_KEY.startsWith('sk-ant-')
  );
}

// =============================================
// Generate a bot message using Claude Haiku
// Haiku is the cheapest/fastest model — perfect for bots
// =============================================
export async function generateBotMessage(
  systemPrompt: string,
  contextMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  userPrompt: string
): Promise<string> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6', // Sonnet: far better creative output and context-following than Haiku
    max_tokens: 180, // room for 2-3 unhinged sentences without cutoff
    system: systemPrompt,
    messages: [
      ...contextMessages,
      { role: 'user', content: userPrompt },
    ],
  });

  const content = response.content[0];
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Anthropic');
  }

  // Strip asterisk stage directions like *pauses* or *nods slowly* — Haiku ignores prompt rules
  const stripped = content.text
    .trim()
    .replace(/\*[^*]+\*/g, '')   // remove *action text*
    .replace(/\s{2,}/g, ' ')     // collapse double spaces
    .trim();

  return stripped || content.text.trim(); // fallback if stripping nukes the whole message
}
