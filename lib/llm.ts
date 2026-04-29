// =============================================
// LLM CLIENT — Groq + Llama 3.3 70B
// OpenAI-compatible API, no extra packages needed
// Llama has no content filters — full creative control
// =============================================

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const MODEL = 'mixtral-8x7b-32768';

export function isLLMConfigured(): boolean {
  return !!process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'placeholder-groq-key';
}

export async function generateBotMessage(
  systemPrompt: string,
  contextMessages: Array<{ role: 'user' | 'assistant'; content: string }>,
  userPrompt: string
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');

  const response = await fetch(`${GROQ_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      temperature: 1.2,
      messages: [
        { role: 'system', content: systemPrompt },
        ...contextMessages,
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const text: string = data.choices?.[0]?.message?.content ?? '';

  const stripped = text
    .trim()
    .replace(/\*[^*]+\*/g, '')  // remove *stage directions*
    .replace(/\s{2,}/g, ' ')
    .trim();

  return stripped || text.trim();
}
