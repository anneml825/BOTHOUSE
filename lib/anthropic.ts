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
    model: 'claude-haiku-4-5-20251001', // Cheapest and fastest — perfect for bots
    max_tokens: 120, // 2-3 complete sentences without cutoff
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

  return content.text.trim();
}
